import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import * as DModeling from "@duplojs/lang/modeling";
import { GoAST } from "@go";
import { TsAST } from "@typescript";
import { SignatureKind } from "typescript/async";
import type { BuildContext } from "../../../../context/build";
import { expressionTransformers } from "../../../expression";
import {
	eitherDependency,
	eitherTypeIdentifier,
	getValueMethodIdentifier,
	isRightMethodIdentifier,
} from "../sharedDependency";
import { eitherSuccessDependency, successFunctionIdentifier } from "../success/sharedDependency";
import { getEitherRightValueType, invokeCallable } from "../../callable";

export async function groupExpressionHandler(
	node: TsAST.Node,
	context: BuildContext,
	isAsync = false,
) {
	if (!TsAST.isCallExpression(node) || node.arguments.length < 1) {
		return context.notSupport();
	}

	const { typeChecker } = context.transpilation;
	const arrayArg = node.arguments[0]!;

	const eitherPkg = context.registerSharedDependency(eitherDependency.value);
	const successPkg = context.registerSharedDependency(eitherSuccessDependency.value);

	const eitherTypeRef = GoAST.createPackageTypeReference({
		packageName: eitherPkg,
		identifier: eitherTypeIdentifier,
	});

	// Déterminer le type de la valeur Right attendue
	const nodeType = await typeChecker.getTypeAtLocation(node);
	let rightType = await getEitherRightValueType(nodeType, node, context);

	let elemType: GoAST.Type | GoAST.TypeReference = GoAST.builtinTypeReferences.float64;
	if (rightType) {
		if (DModeling.hasTagValue(rightType, "[node][type]slice")) {
			elemType = (rightType as GoAST.SliceType).elementType;
		} else if (DModeling.hasTagValue(rightType, "[node][type]array")) {
			elemType = (rightType as GoAST.ArrayType).elementType;
		} else {
			elemType = rightType;
		}
	} else {
		const argType = await typeChecker.getTypeAtLocation(arrayArg);
		const argTypeNode = await typeChecker.typeToTypeNode(argType, arrayArg);
		if (argTypeNode && TsAST.isArrayTypeNode(argTypeNode)) {
			const innerEitherType = await typeChecker.getTypeAtLocation(argTypeNode.elementType);
			const innerRightType = await getEitherRightValueType(innerEitherType, arrayArg, context);
			if (innerRightType) {
				elemType = innerRightType;
			}
		}
	}

	// Cas A : arrayArg est un ArrayLiteralExpression
	if (TsAST.isArrayLiteralExpression(arrayArg)) {
		const count = arrayArg.elements.length;
		const valsVar = context.generateIdentifier();
		const resVar = context.generateIdentifier();
		const okVar = context.generateIdentifier();

		const beforeStatements: GoAST.Statement[] = [
			GoAST.createShortVariableDeclarationStatement({
				identifier: valsVar,
				initializer: GoAST.createCallExpression({
					callee: GoAST.createIdentifier("make"),
					typeArgument: GoAST.createSliceType({ elementType: elemType }),
					arguments: [GoAST.createIntegerLiteral({ value: BigInt(count) })],
				}),
			}),
			GoAST.createVariableDeclarationZeroValue({
				identifier: resVar,
				typeReference: eitherTypeRef,
			}),
			GoAST.createShortVariableDeclarationStatement({
				identifier: okVar,
				initializer: GoAST.createBooleanLiteral({ value: true }),
			}),
		];

		let currentTarget = beforeStatements;

		for (let i = 0; i < count; i++) {
			const elem = arrayArg.elements[i]!;
			let stepExpr: GoAST.Expression;
			const stepBefore: GoAST.Statement[] = [];

			const elemTypeAtLoc = await typeChecker.getTypeAtLocation(elem);
			const sigs = await typeChecker.getSignaturesOfType(elemTypeAtLoc, SignatureKind.Call);

			if (sigs.length > 0) {
				const invoked = await DCommon.asyncPipe(
					invokeCallable(elem, undefined, context),
					DEither.unwrapRight,
				);
				if (DEither.isLeft(invoked)) {
					return context.error(elem, "group-step-callable-error");
				}
				stepBefore.push(...invoked.before);
				stepExpr = invoked.result;
			} else {
				const transformed = await DCommon.asyncPipe(
					context.transform(elem, expressionTransformers.value),
					DEither.unwrapRight,
				);
				if (DEither.isLeft(transformed)) {
					return transformed;
				}
				stepBefore.push(...(transformed.before ?? []));
				stepExpr = transformed.result;
			}

			const stepItemVar = context.generateIdentifier();
			currentTarget.push(
				...stepBefore,
				GoAST.createShortVariableDeclarationStatement({
					identifier: stepItemVar,
					initializer: stepExpr,
				}),
			);

			const elseStatements: GoAST.Statement[] = [
				GoAST.createAssignmentStatement({
					targets: DCommon.cast([
						GoAST.createIndexExpression({
							target: valsVar,
							index: GoAST.createIntegerLiteral({ value: BigInt(i) }),
						}),
					]),
					values: DCommon.cast([
						GoAST.createTypeAssertionExpression({
							target: GoAST.createCallExpression({
								callee: GoAST.createSelectorExpression({
									target: stepItemVar,
									identifier: getValueMethodIdentifier,
								}),
								arguments: [],
							}),
							typeReference: elemType,
						}),
					]),
				}),
			];

			const ifFailStmt = GoAST.createIfStatement({
				condition: GoAST.createUnaryExpression({
					operator: "!",
					operand: GoAST.createCallExpression({
						callee: GoAST.createSelectorExpression({
							target: stepItemVar,
							identifier: isRightMethodIdentifier,
						}),
						arguments: [],
					}),
				}),
				body: GoAST.createBlockStatement({
					statements: [
						GoAST.createAssignmentStatement({
							targets: DCommon.cast([resVar]),
							values: DCommon.cast([stepItemVar]),
						}),
						GoAST.createAssignmentStatement({
							targets: DCommon.cast([okVar]),
							values: DCommon.cast([GoAST.createBooleanLiteral({ value: false })]),
						}),
					],
				}),
				elseBranch: GoAST.createBlockStatement({
					statements: elseStatements,
				}),
			});

			currentTarget.push(ifFailStmt);
			currentTarget = elseStatements;
		}

		beforeStatements.push(
			GoAST.createIfStatement({
				condition: okVar,
				body: GoAST.createBlockStatement({
					statements: [
						GoAST.createAssignmentStatement({
							targets: DCommon.cast([resVar]),
							values: DCommon.cast([
								GoAST.createCallExpression({
									callee: GoAST.createSelectorExpression({
										target: successPkg,
										identifier: successFunctionIdentifier,
									}),
									arguments: [valsVar],
								}),
							]),
						}),
					],
				}),
			}),
		);

		return context.success({
			before: beforeStatements,
			result: resVar,
		});
	}

	// Cas B : arrayArg est une expression dynamique (ex: calculations)
	const transformedArray = await DCommon.asyncPipe(
		context.transform(arrayArg, expressionTransformers.value),
		DEither.unwrapRight,
	);
	if (DEither.isLeft(transformedArray)) {
		return transformedArray;
	}

	const arrVar = context.generateIdentifier();
	const valsVar = context.generateIdentifier();
	const resVar = context.generateIdentifier();
	const okVar = context.generateIdentifier();
	const iVar = context.generateIdentifier();
	const itemVar = context.generateIdentifier();

	const loopStatements: GoAST.Statement[] = [
		GoAST.createIfStatement({
			condition: GoAST.createUnaryExpression({
				operator: "!",
				operand: GoAST.createCallExpression({
					callee: GoAST.createSelectorExpression({
						target: itemVar,
						identifier: isRightMethodIdentifier,
					}),
					arguments: [],
				}),
			}),
			body: GoAST.createBlockStatement({
				statements: [
					GoAST.createAssignmentStatement({
						targets: DCommon.cast([resVar]),
						values: DCommon.cast([itemVar]),
					}),
					GoAST.createAssignmentStatement({
						targets: DCommon.cast([okVar]),
						values: DCommon.cast([GoAST.createBooleanLiteral({ value: false })]),
					}),
					GoAST.createBreakStatement({}),
				],
			}),
		}),
		GoAST.createAssignmentStatement({
			targets: DCommon.cast([
				GoAST.createIndexExpression({
					target: valsVar,
					index: iVar,
				}),
			]),
			values: DCommon.cast([
				GoAST.createTypeAssertionExpression({
					target: GoAST.createCallExpression({
						callee: GoAST.createSelectorExpression({
							target: itemVar,
							identifier: getValueMethodIdentifier,
						}),
						arguments: [],
					}),
					typeReference: elemType,
				}),
			]),
		}),
	];

	const beforeStatements: GoAST.Statement[] = [
		...(transformedArray.before ?? []),
		GoAST.createShortVariableDeclarationStatement({
			identifier: arrVar,
			initializer: transformedArray.result,
		}),
		GoAST.createShortVariableDeclarationStatement({
			identifier: valsVar,
			initializer: GoAST.createCallExpression({
				callee: GoAST.createIdentifier("make"),
				typeArgument: GoAST.createSliceType({ elementType: elemType }),
				arguments: [
					GoAST.createCallExpression({
						callee: GoAST.createIdentifier("len"),
						arguments: [arrVar],
					}),
				],
			}),
		}),
		GoAST.createVariableDeclarationZeroValue({
			identifier: resVar,
			typeReference: eitherTypeRef,
		}),
		GoAST.createShortVariableDeclarationStatement({
			identifier: okVar,
			initializer: GoAST.createBooleanLiteral({ value: true }),
		}),
		GoAST.createRangeStatement({
			binding: GoAST.createRangeDeclaration({
				key: iVar,
				value: itemVar,
			}),
			expression: arrVar,
			body: GoAST.createBlockStatement({
				statements: loopStatements,
			}),
		}),
		GoAST.createIfStatement({
			condition: okVar,
			body: GoAST.createBlockStatement({
				statements: [
					GoAST.createAssignmentStatement({
						targets: DCommon.cast([resVar]),
						values: DCommon.cast([
							GoAST.createCallExpression({
								callee: GoAST.createSelectorExpression({
									target: successPkg,
									identifier: successFunctionIdentifier,
								}),
								arguments: [valsVar],
							}),
						]),
					}),
				],
			}),
		}),
	];

	return context.success({
		before: beforeStatements,
		result: resVar,
	});
}

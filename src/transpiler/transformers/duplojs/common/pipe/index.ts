import * as DCommon from "@duplojs/lang/common";
import * as DArray from "@duplojs/lang/array";
import * as DEither from "@duplojs/lang/either";
import * as DModeling from "@duplojs/lang/modeling";
import { GoAST } from "@go";
import { TsAST } from "@typescript";
import { SignatureKind } from "typescript/async";
import type { BuildContext } from "../../../../context/build";
import { expressionTransformers } from "../../../expression";
import { invokeCallable, getEitherRightValueType } from "../../callable";
import {
	eitherDependency,
	eitherTypeIdentifier,
	getValueMethodIdentifier,
	isRightMethodIdentifier,
} from "../../either/sharedDependency";
import { arrayMapDependency, arrayMapFunctionIdentifier } from "../../array/map/sharedDependency";
import { transformCheckerType } from "../../../type/fromChecker";

export async function pipeExpressionHandler(
	node: TsAST.Node,
	context: BuildContext,
) {
	if (!TsAST.isCallExpression(node) || node.arguments.length < 2) {
		return context.notSupport();
	}

	const { typeChecker } = context.transpilation;

	const initArg = node.arguments[0]!;
	const transformedInit = await DCommon.asyncPipe(
		context.transform(initArg, expressionTransformers.value),
		DEither.unwrapRight,
	);
	if (DEither.isLeft(transformedInit)) {
		return transformedInit;
	}

	let currentExpr: GoAST.Expression = transformedInit.result;
	const beforeStatements: GoAST.Statement[] = [...(transformedInit.before ?? [])];

	// Si init n'est pas déjà un identifiant, on l'assigne à une variable locale intermédiaire
	if (!DModeling.hasTagValue(currentExpr, "[node]identifier")) {
		const initVar = context.generateIdentifier();
		beforeStatements.push(
			GoAST.createShortVariableDeclarationStatement({
				identifier: initVar,
				initializer: currentExpr,
			}),
		);
		currentExpr = initVar;
	}

	for (let i = 1; i < node.arguments.length; i++) {
		const stepNode = node.arguments[i]!;

		// Détection DEither.unwrapRight : passthrough en Go
		if (
			TsAST.isPropertyAccessExpression(stepNode)
			&& stepNode.name.text === "unwrapRight"
		) {
			if (node.parent && TsAST.isVariableDeclaration(node.parent) && TsAST.isIdentifier(node.parent.name)) {
				context.file.unwrappedVariables.add(node.parent.name.text);
			}
			continue;
		}

		// Détection appel currying : stepNode est un CallExpression
		if (TsAST.isCallExpression(stepNode)) {
			const callee = stepNode.expression;
			let calleeName = "";
			if (TsAST.isPropertyAccessExpression(callee)) {
				calleeName = callee.name.text;
			} else if (TsAST.isIdentifier(callee)) {
				calleeName = callee.text;
			}

			// whenIsRight(fn) dans pipe
			if (calleeName === "whenIsRight" && stepNode.arguments.length === 1) {
				const fnArg = stepNode.arguments[0]!;
				const eitherVar = currentExpr;

				const prevType = await typeChecker.getTypeAtLocation(node.arguments[i - 1]!);
				const rightValueType = await getEitherRightValueType(prevType, stepNode, context);

				let argExpr: GoAST.Expression = eitherVar;
				if (rightValueType) {
					argExpr = GoAST.createTypeAssertionExpression({
						target: GoAST.createCallExpression({
							callee: GoAST.createSelectorExpression({
								target: eitherVar,
								identifier: getValueMethodIdentifier,
							}),
							arguments: [],
						}),
						typeReference: rightValueType,
					});
				}

				const invoked = await DCommon.asyncPipe(
					invokeCallable(fnArg, argExpr, context),
					DEither.unwrapRight,
				);
				if (DEither.isLeft(invoked)) {
					return context.error(stepNode, "pipe-whenIsRight-error");
				}

				const resultVar = context.generateIdentifier();

				let resultType: GoAST.Type | GoAST.TypeReference = GoAST.builtinTypeReferences.any;
				const fnType = await typeChecker.getTypeAtLocation(fnArg);
				const fnRightType = await getEitherRightValueType(fnType, fnArg, context);
				if (fnRightType !== undefined) {
					resultType = GoAST.createPackageTypeReference({
						packageName: context.registerSharedDependency(eitherDependency.value),
						identifier: eitherTypeIdentifier,
					});
				}

				const resultVarDecl = GoAST.createVariableDeclarationZeroValue({
					identifier: resultVar,
					typeReference: resultType,
				});

				const ifStmt = GoAST.createIfStatement({
					condition: GoAST.createCallExpression({
						callee: GoAST.createSelectorExpression({
							target: eitherVar,
							identifier: isRightMethodIdentifier,
						}),
						arguments: [],
					}),
					body: GoAST.createBlockStatement({
						statements: [
							...invoked.before,
							GoAST.createAssignmentStatement({
								targets: DCommon.cast([resultVar]),
								values: DCommon.cast([invoked.result]),
							}),
						],
					}),
					elseBranch: GoAST.createBlockStatement({
						statements: [
							GoAST.createAssignmentStatement({
								targets: DCommon.cast([resultVar]),
								values: DCommon.cast([eitherVar]),
							}),
						],
					}),
				});

				beforeStatements.push(resultVarDecl, ifStmt);
				currentExpr = resultVar;
				continue;
			}

			// whenIsRightOtherwise(onRight, onLeft) dans pipe
			if (calleeName === "whenIsRightOtherwise" && stepNode.arguments.length === 2) {
				const onRightArg = stepNode.arguments[0]!;
				const onLeftArg = stepNode.arguments[1]!;
				const eitherVar = currentExpr;

				const prevType = await typeChecker.getTypeAtLocation(node.arguments[i - 1]!);
				const rightValueType = await getEitherRightValueType(prevType, stepNode, context);

				let argExpr: GoAST.Expression = eitherVar;
				if (rightValueType) {
					argExpr = GoAST.createTypeAssertionExpression({
						target: GoAST.createCallExpression({
							callee: GoAST.createSelectorExpression({
								target: eitherVar,
								identifier: getValueMethodIdentifier,
							}),
							arguments: [],
						}),
						typeReference: rightValueType,
					});
				}

				const invokedRight = await DCommon.asyncPipe(
					invokeCallable(onRightArg, argExpr, context),
					DEither.unwrapRight,
				);
				if (DEither.isLeft(invokedRight)) {
					return context.error(stepNode, { message: "pipe-whenIsRightOtherwise-onRight-error", cause: invokedRight });
				}

				const invokedLeft = await DCommon.asyncPipe(
					invokeCallable(onLeftArg, undefined, context),
					DEither.unwrapRight,
				);
				if (DEither.isLeft(invokedLeft)) {
					return context.error(stepNode, "pipe-whenIsRightOtherwise-onLeft-error");
				}

				// Type statique de retour via la signature de onLeftArg
				let resultType: GoAST.Type | GoAST.TypeReference = GoAST.builtinTypeReferences.any;
				const leftSig = DArray.first(
					await typeChecker.getSignaturesOfType(
						await typeChecker.getTypeAtLocation(onLeftArg),
						SignatureKind.Call,
					),
				);
				if (leftSig) {
					const retType = await typeChecker.getReturnTypeOfSignature(leftSig);
					const transformed = await DCommon.asyncPipe(
						transformCheckerType(retType, onLeftArg, context),
						DEither.unwrapRight,
					);
					if (!DEither.isLeft(transformed)) {
						resultType = transformed.result;
						if (DModeling.hasTagValue(resultType, "[node][type]array")) {
							const arr = resultType as GoAST.ArrayType;
							if (DModeling.hasTagValue(arr.length, "[node][expression]literal-integer") && (arr.length as GoAST.IntegerLiteral).value === 1n) {
								resultType = GoAST.createSliceType({ elementType: arr.elementType });
							}
						}
					}
				}

				const resultVar = context.generateIdentifier();
				const resultVarDecl = GoAST.createVariableDeclarationZeroValue({
					identifier: resultVar,
					typeReference: resultType,
				});

				const ifStmt = GoAST.createIfStatement({
					condition: GoAST.createCallExpression({
						callee: GoAST.createSelectorExpression({
							target: eitherVar,
							identifier: isRightMethodIdentifier,
						}),
						arguments: [],
					}),
					body: GoAST.createBlockStatement({
						statements: [
							...invokedRight.before,
							GoAST.createAssignmentStatement({
								targets: DCommon.cast([resultVar]),
								values: DCommon.cast([invokedRight.result]),
							}),
						],
					}),
					elseBranch: GoAST.createBlockStatement({
						statements: [
							...invokedLeft.before,
							GoAST.createAssignmentStatement({
								targets: DCommon.cast([resultVar]),
								values: DCommon.cast([invokedLeft.result]),
							}),
						],
					}),
				});

				beforeStatements.push(resultVarDecl, ifStmt);
				currentExpr = resultVar;
				continue;
			}

			// DArray.map(fn) dans pipe
			if (calleeName === "map" && stepNode.arguments.length === 1) {
				const fnArg = stepNode.arguments[0]!;
				const transformedFn = await DCommon.asyncPipe(
					context.transform(fnArg, expressionTransformers.value),
					DEither.unwrapRight,
				);
				if (DEither.isLeft(transformedFn)) {
					return transformedFn;
				}

				beforeStatements.push(...(transformedFn.before ?? []));
				const nextVar = context.generateIdentifier();
				beforeStatements.push(
					GoAST.createShortVariableDeclarationStatement({
						identifier: nextVar,
						initializer: GoAST.createCallExpression({
							callee: GoAST.createSelectorExpression({
								target: context.registerSharedDependency(arrayMapDependency.value),
								identifier: arrayMapFunctionIdentifier,
							}),
							arguments: [currentExpr, transformedFn.result],
						}),
					}),
				);
				currentExpr = nextVar;
				continue;
			}
		}

		// Appel callable standard (identifier, arrow function, property access)
		const prevType = await typeChecker.getTypeAtLocation(node.arguments[i - 1]!);
		const invoked = await DCommon.asyncPipe(
			invokeCallable(stepNode, currentExpr, context, prevType),
			DEither.unwrapRight,
		);
		if (DEither.isLeft(invoked)) {
			return context.error(stepNode, "pipe-step-callable-error");
		}

		beforeStatements.push(...invoked.before);
		const nextVar = context.generateIdentifier();
		beforeStatements.push(
			GoAST.createShortVariableDeclarationStatement({
				identifier: nextVar,
				initializer: invoked.result,
			}),
		);
		currentExpr = nextVar;
	}

	return context.success({
		before: beforeStatements,
		result: currentExpr,
	});
}

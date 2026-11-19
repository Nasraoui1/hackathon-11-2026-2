import * as DCommon from "@duplojs/lang/common";
import * as DArray from "@duplojs/lang/array";
import * as DEither from "@duplojs/lang/either";
import { GoAST } from "@go";
import { TsAST } from "@typescript";
import { SignatureKind } from "typescript/async";
import type { BuildContext } from "../../../../context/build";
import { expressionTransformers } from "../../../expression";
import { transformCheckerType } from "../../../type/fromChecker";
import {
	eitherDependency,
	eitherTypeIdentifier,
	getValueMethodIdentifier,
	isRightMethodIdentifier,
} from "../sharedDependency";
import { invokeCallable, getEitherRightValueType } from "../../callable";

export async function whenIsRightExpressionHandler(
	node: TsAST.Node,
	context: BuildContext,
) {
	if (!TsAST.isCallExpression(node)) {
		return context.notSupport();
	}

	const { typeChecker } = context.transpilation;

	// Forme data-first : DEither.whenIsRight(either, fn)
	if (node.arguments.length === 2) {
		const eitherArg = node.arguments[0]!;
		const fnArg = node.arguments[1]!;

		const transformedEither = await DCommon.asyncPipe(
			context.transform(eitherArg, expressionTransformers.value),
			DEither.unwrapRight,
		);
		if (DEither.isLeft(transformedEither)) {
			return transformedEither;
		}

		const eitherVar = context.generateIdentifier();
		const eitherDecl = GoAST.createShortVariableDeclarationStatement({
			identifier: eitherVar,
			initializer: transformedEither.result,
		});

		// Résolution de l'argument à passer à fnArg
		const eitherType = await typeChecker.getTypeAtLocation(eitherArg);
		const rightValueType = await getEitherRightValueType(eitherType, eitherArg, context);

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
			return context.error(node, "whenIsRight-callable-error");
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

		return context.success({
			before: [
				...(transformedEither.before ?? []),
				eitherDecl,
				resultVarDecl,
				ifStmt,
			],
			result: resultVar,
		});
	}

	return context.error(node, "whenIsRight-invalid-arguments");
}

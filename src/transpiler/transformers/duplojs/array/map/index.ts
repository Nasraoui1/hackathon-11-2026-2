import { GoAST } from "@go";
import { TsAST } from "@typescript";
import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { type BuildContext } from "../../../../context/build";
import { expressionTransformers } from "../../../expression";
import { arrayMapDependency, arrayMapFunctionIdentifier } from "./sharedDependency";

export async function mapExpressionHandler(
	node: TsAST.Node,
	context: BuildContext,
) {
	if (TsAST.isCallExpression(node)) {
		if (node.arguments.length === 2) {
			const itemsArg = node.arguments[0]!;
			const fnArg = node.arguments[1]!;

			const transformedItems = await DCommon.asyncPipe(
				context.transform(itemsArg, expressionTransformers.value),
				DEither.unwrapRight,
			);
			if (DEither.isLeft(transformedItems)) {
				return transformedItems;
			}

			const transformedFn = await DCommon.asyncPipe(
				context.transform(fnArg, expressionTransformers.value),
				DEither.unwrapRight,
			);
			if (DEither.isLeft(transformedFn)) {
				return transformedFn;
			}

			return context.success({
				before: [
					...(transformedItems.before ?? []),
					...(transformedFn.before ?? []),
				],
				result: GoAST.createCallExpression({
					callee: GoAST.createSelectorExpression({
						target: context.registerSharedDependency(arrayMapDependency.value),
						identifier: arrayMapFunctionIdentifier,
					}),
					arguments: [transformedItems.result, transformedFn.result],
				}),
			});
		}

		if (node.arguments.length === 1) {
			// Curried DArray.map(fn)
			const fnArg = node.arguments[0]!;
			const transformedFn = await DCommon.asyncPipe(
				context.transform(fnArg, expressionTransformers.value),
				DEither.unwrapRight,
			);
			if (DEither.isLeft(transformedFn)) {
				return transformedFn;
			}

			// Returns a closure func(items []T) []R
			const itemsIdent = GoAST.createIdentifier("items");
			return context.success({
				before: transformedFn.before ?? [],
				result: GoAST.createFunctionLiteral({
					arguments: [
						GoAST.createFunctionArgument({
							identifier: itemsIdent,
							type: GoAST.builtinTypeReferences.any,
						}),
					],
					returnTypes: [],
					body: GoAST.createBlockStatement({
						statements: [
							GoAST.createReturnStatement({
								values: [
									GoAST.createCallExpression({
										callee: GoAST.createSelectorExpression({
											target: context.registerSharedDependency(arrayMapDependency.value),
											identifier: arrayMapFunctionIdentifier,
										}),
										arguments: [itemsIdent, transformedFn.result],
									}),
								],
							}),
						],
					}),
				}),
			});
		}
	}

	return context.success({
		result: GoAST.createSelectorExpression({
			target: context.registerSharedDependency(arrayMapDependency.value),
			identifier: arrayMapFunctionIdentifier,
		}),
	});
}

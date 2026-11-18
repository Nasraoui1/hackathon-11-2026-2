import { GoAST } from "@go";
import { TsAST } from "@typescript";
import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { type BuildContext } from "../../../../context/build";
import { callExpressionTransformer } from "../../../shared";
import { typeTransformers } from "../../../type";
import { eitherLeftDependency, leftFunctionIdentifier, leftTypeIdentifier } from "./sharedDependency";

/**
 * `DEither.left("information", value)` → `shard_dependencies.EitherLeftOf("information", value)`.
 * Go infère `T` depuis `value`. La forme sans valeur, `left("information")`,
 * n'est pas prise en charge (la valeur serait `undefined`).
 */
export function leftExpressionHandler(
	node: TsAST.Node,
	context: BuildContext,
) {
	if (TsAST.isCallExpression(node)) {
		if (node.arguments.length !== 2) {
			return context.error(node, "left-requires-information-and-value");
		}

		return context.transform(node, [callExpressionTransformer]);
	}

	return context.success({
		result: GoAST.createSelectorExpression({
			target: context.registerSharedDependency(eitherLeftDependency.value),
			identifier: leftFunctionIdentifier,
		}),
	});
}

/**
 * Type `DEither.Left<"information", V>` seul → `shard_dependencies.EitherLeft[V]`.
 */
export async function leftTypeHandler(
	node: TsAST.TypeReferenceNode | TsAST.ImportTypeNode,
	context: BuildContext,
) {
	const valueNode = node.typeArguments && DArray.at(node.typeArguments, 1);

	if (!valueNode) {
		return context.notSupport();
	}

	const value = await DCommon.asyncPipe(
		context.transform(valueNode, typeTransformers.value),
		DEither.unwrapRight,
	);

	if (DEither.isLeft(value)) {
		return value;
	}

	return context.success({
		before: value.before,
		result: GoAST.createGenericTypeReference({
			typeReference: GoAST.createPackageTypeReference({
				packageName: context.registerSharedDependency(eitherLeftDependency.value),
				identifier: leftTypeIdentifier,
			}),
			typeArguments: DCommon.cast([value.result]),
		}),
	});
}

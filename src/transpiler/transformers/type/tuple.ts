import { GoAST } from "@go";
import { createTransformer, type Transformer, type TransformationSuccessPayload } from "@transformer";
import { TsAST } from "@typescript";
import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { typeTransformers } from ".";

export const tupleTypeTransformer: Transformer<GoAST.SliceType | GoAST.StructType> = createTransformer(
	async(node, context) => {
		if (!TsAST.isTupleTypeNode(node)) {
			return context.notSupport();
		}

		if (node.elements.length === 0) {
			return context.success({
				result: GoAST.createSliceType({
					elementType: GoAST.builtinTypeReferences.any,
				}),
			});
		}

		const elementResults = await DCommon.asyncPipe(
			node.elements,
			DArray.map(async(elementNode) => DCommon.asyncPipe(
				context.transform(elementNode, typeTransformers.value),
				DEither.unwrapRight,
			)),
			DCommon.promiseAll,
		);

		for (const res of elementResults) {
			if (DEither.isLeft(res)) {
				return res;
			}
		}

		const successfulResults = elementResults as readonly TransformationSuccessPayload<GoAST.Type | GoAST.TypeReference>[];
		const firstType = successfulResults[0]?.result ?? GoAST.builtinTypeReferences.any;
		const before = DArray.flatMap(successfulResults, (res) => res.before ?? []);

		return context.success({
			before,
			result: GoAST.createSliceType({
				elementType: firstType,
			}),
		});
	},
);

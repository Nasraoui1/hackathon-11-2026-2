import { GoAST } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import { TsAST } from "@typescript";

export const float64TypeTransformer: Transformer<GoAST.BuiltinTypeReference<"float64">> = createTransformer(
	(node, context) => {
		// `number`, ou un littéral numérique (`3`, `-1`) que le checker peut produire.
		const isNumber = node.kind === TsAST.SyntaxKind.NumberKeyword
			|| (
				TsAST.isLiteralTypeNode(node)
				&& (
					TsAST.isNumericLiteral(node.literal)
					|| (TsAST.isPrefixUnaryExpression(node.literal) && TsAST.isNumericLiteral(node.literal.operand))
				)
			);

		if (!isNumber) {
			return context.notSupport();
		}

		return context.success({
			result: GoAST.builtinTypeReferences.float64,
		});
	},
);

import { GoAST } from "@go";
import { TsAST } from "@typescript";
import { type BuildContext } from "../../../../context/build";
import { callExpressionTransformer } from "../../../shared";
import { arrayCoalescingDependency, arrayCoalescingFunctionIdentifier } from "./sharedDependency";

export async function coalescingExpressionHandler(
	node: TsAST.Node,
	context: BuildContext,
) {
	if (TsAST.isCallExpression(node)) {
		return context.transform(node, [callExpressionTransformer]);
	}

	return context.success({
		result: GoAST.createSelectorExpression({
			target: context.registerSharedDependency(arrayCoalescingDependency.value),
			identifier: arrayCoalescingFunctionIdentifier,
		}),
	});
}

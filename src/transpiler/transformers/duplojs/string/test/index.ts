import { GoAST } from "@go";
import { TsAST } from "@typescript";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { type BuildContext } from "../../../../context/build";
import { expressionTransformers } from "../../../expression";

export async function testExpressionHandler(
	node: TsAST.Node,
	context: BuildContext,
) {
	if (!TsAST.isCallExpression(node) || node.arguments.length < 2) {
		return context.notSupport();
	}

	context.file.imports.add(
		GoAST.createImportDeclaration({ path: "regexp" }),
	);

	const strArg = node.arguments[0]!;
	const regexArg = node.arguments[1]!;

	let pattern = "";
	if (TsAST.isRegularExpressionLiteral(regexArg)) {
		pattern = regexArg.text.replace(/^\/|\/[a-z]*$/g, "");
	} else if (TsAST.isStringLiteral(regexArg)) {
		pattern = regexArg.text;
	}

	const transformedStr = await DCommon.asyncPipe(
		context.transform(strArg, expressionTransformers.value),
		DEither.unwrapRight,
	);
	if (DEither.isLeft(transformedStr)) {
		return transformedStr;
	}

	return context.success({
		before: transformedStr.before ?? [],
		result: GoAST.createCallExpression({
			callee: GoAST.createSelectorExpression({
				target: GoAST.createCallExpression({
					callee: GoAST.createSelectorExpression({
						target: GoAST.createIdentifier("regexp"),
						identifier: GoAST.createIdentifier("MustCompile"),
					}),
					arguments: [GoAST.createStringLiteral({ value: pattern })],
				}),
				identifier: GoAST.createIdentifier("MatchString"),
			}),
			arguments: [transformedStr.result],
		}),
	});
}

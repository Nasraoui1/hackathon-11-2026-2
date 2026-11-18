import { TsAST } from "@typescript";
import { GoAST } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { expressionTransformers } from ".";
import { transformCheckerType } from "../type/fromChecker";
import { blockStatementTransformer } from "../statement/block";

/**
 * `(value) => expression` → `func(value T) R { return expression }`.
 * `(value) => { ... }` → `func(value T) R { ... }`.
 * Les types des paramètres et du retour viennent du checker : dans
 * `matchInformation(x, { success: (value) => … })`, TypeScript les déduit du contexte
 * alors que le source ne les écrit pas.
 * Limites : paramètres simples uniquement (pas de déstructuration), pas d'`async`.
 */
export const arrowFunctionTransformer: Transformer<GoAST.FunctionLiteral> = createTransformer(
	async(node, context) => {
		if (!TsAST.isArrowFunction(node)) {
			return context.notSupport();
		}

		const { typeChecker } = context.transpilation;

		const functionArguments: GoAST.FunctionArgument[] = [];

		for (const parameter of node.parameters) {
			if (!TsAST.isIdentifier(parameter.name)) {
				return context.error(parameter, "arrow-function-parameter-is-not-identifier");
			}

			const parameterType = await DCommon.asyncPipe(
				transformCheckerType(await typeChecker.getTypeAtLocation(parameter), parameter, context),
				DEither.unwrapRight,
			);

			if (DEither.isLeft(parameterType)) {
				return parameterType;
			}

			functionArguments.push(GoAST.createFunctionArgument({
				identifier: context.createSourceIdentifier(parameter.name.text),
				type: parameterType.result,
			}));
		}

		const signature = await typeChecker.getSignatureFromDeclaration(node);
		const returnType = await DCommon.asyncPipe(
			transformCheckerType(await typeChecker.getReturnTypeOfSignature(signature), node, context),
			DEither.unwrapRight,
		);

		if (DEither.isLeft(returnType)) {
			return returnType;
		}

		const createFunctionLiteral = (body: GoAST.BlockStatement) => context.success({
			result: GoAST.createFunctionLiteral({
				arguments: functionArguments,
				returnTypes: [returnType.result],
				body,
			}),
		});

		if (TsAST.isBlock(node.body)) {
			const block = await DCommon.asyncPipe(
				context.transform(node.body, [blockStatementTransformer]),
				DEither.unwrapRight,
			);

			return DEither.isLeft(block) ? block : createFunctionLiteral(block.result);
		}

		// Corps expression : ses `before` restent dans la fonction, avant le `return`.
		const expression = await DCommon.asyncPipe(
			context.transform(node.body, expressionTransformers.value),
			DEither.unwrapRight,
		);

		if (DEither.isLeft(expression)) {
			return expression;
		}

		return createFunctionLiteral(GoAST.createBlockStatement({
			statements: DArray.concat(
				expression.before,
				[GoAST.createReturnStatement({ values: [expression.result] })],
			),
		}));
	},
);

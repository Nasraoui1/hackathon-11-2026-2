import * as DCommon from "@duplojs/lang/common";
import { type Transformer } from "@transformer";
import type { GoAST } from "@go";
import { duploJSExpressionTransformers } from "../duplojs";
import { identifierTransformer } from "../common";
import { numericLiteralTransformer } from "./numericLiteral";
import { sharedExpressionTransformers } from "../shared";
import { binaryExpressionTransformer } from "./binary";
import { prefixUnaryExpressionTransformer } from "./prefixUnary";
import { stringLiteralTransformer } from "./stringLiteral";
import { conditionalExpressionTransformer } from "./conditional";
import { arrowFunctionTransformer } from "./arrowFunction";
import { logicalExpressionTransformer } from "./logical";
import { typeAssertionExpressionTransformer } from "./typeAssertion";

export const expressionTransformers = DCommon.memo(
	(): readonly Transformer<GoAST.Expression>[] => [
		...duploJSExpressionTransformers.value,
		...sharedExpressionTransformers.value,
		identifierTransformer,
		numericLiteralTransformer,
		stringLiteralTransformer,
		logicalExpressionTransformer,
		binaryExpressionTransformer,
		conditionalExpressionTransformer,
		arrowFunctionTransformer,
		prefixUnaryExpressionTransformer,
		typeAssertionExpressionTransformer,
	],
);

/**
 * @name Untrusted JSON.parse shape reaches an unguarded structural use
 * @description The value produced by a bare `JSON.parse(...)` reaches a member
 *              access, iteration, or array method (`.some`/`.filter`/`.map`/
 *              `for..of`) without first passing an `isPlainObject` /
 *              `Array.isArray` / `typeof` shape barrier, so a `null`, a string
 *              or an array-shaped payload can throw at that use. This is
 *              parse-safety class A from the #812 audit (issue #819): a defect
 *              a purely syntactic ESLint rule cannot follow across function
 *              boundaries.
 * @kind path-problem
 * @problem.severity warning
 * @precision medium
 * @id js/parse-safety/untrusted-shape-to-sink
 * @tags reliability
 *       correctness
 *       parse-safety
 */

import javascript
import ShapeFlow::PathGraph

/**
 * A bare `JSON.parse(...)` call. The sanctioned wrappers `parseJsonObject` /
 * `parseJsonArray` (src/shared/json-shape.ts) validate the top-level shape
 * before returning, so a value obtained from them is deliberately NOT a source
 * here - only the raw, unguarded `JSON.parse` boundary is.
 */
class JsonParseCall extends DataFlow::CallNode {
  JsonParseCall() { this = DataFlow::globalVarRef("JSON").getAMemberCall("parse") }
}

/**
 * A shape barrier: `Array.isArray(x)`, `isPlainObject(x)`, or a
 * `typeof x === 'object'` / `typeof x === 'string'` style test. On the branch
 * where the check succeeds, `x`'s shape is known, so downstream structural use
 * of it is safe.
 */
class ShapeBarrierGuard extends DataFlow::Node {
  Expr guarded;
  boolean polarity;

  ShapeBarrierGuard() {
    exists(DataFlow::CallNode c | c = this |
      (
        c = DataFlow::globalVarRef("Array").getAMemberCall("isArray")
        or
        c.getCalleeName() = "isPlainObject"
      ) and
      guarded = c.getArgument(0).asExpr() and
      polarity = true
    )
    or
    exists(EqualityTest eq, TypeofExpr t |
      this.asExpr() = eq and
      eq.getAnOperand() = t and
      eq.getAnOperand().getStringValue() = ["object", "string", "number", "boolean"] and
      guarded = t.getOperand() and
      polarity = eq.getPolarity()
    )
  }

  predicate blocksExpr(boolean outcome, Expr e) { e = guarded and outcome = polarity }
}

/**
 * A structural use of a value that assumes a specific shape and will throw if
 * the shape is wrong: a property read, or the receiver of an iteration /
 * array-higher-order method.
 */
predicate isStructuralUse(DataFlow::Node node, string kind) {
  exists(DataFlow::PropRead pr | pr.getBase() = node and kind = "a property access")
  or
  exists(DataFlow::MethodCallNode mc |
    mc.getReceiver() = node and
    mc.getMethodName() = ["some", "every", "filter", "map", "forEach", "reduce", "flatMap", "find", "entries", "join"] and
    kind = "an array method ." + mc.getMethodName() + "()"
  )
  or
  exists(ForOfStmt f | f.getIterationDomain() = node.asExpr() and kind = "a for..of iteration")
}

module ShapeConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node source) { source instanceof JsonParseCall }

  predicate isSink(DataFlow::Node sink) { isStructuralUse(sink, _) }

  predicate isBarrier(DataFlow::Node node) {
    node = DataFlow::MakeBarrierGuard<ShapeBarrierGuard>::getABarrierNode()
  }
}

module ShapeFlow = TaintTracking::Global<ShapeConfig>;

from ShapeFlow::PathNode source, ShapeFlow::PathNode sink, string kind
where ShapeFlow::flowPath(source, sink) and isStructuralUse(sink.getNode(), kind)
select sink.getNode(), source, sink,
  "Unvalidated JSON.parse output reaches " + kind + " without a shape barrier; the $@ may be null, a string or an array.",
  source.getNode(), "parsed value"

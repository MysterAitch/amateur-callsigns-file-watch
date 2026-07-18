/**
 * @name Silent NaN from external-numeric parsing reaches an unguarded numeric sink
 * @description The value produced by `Number(...)`, `parseInt(...)` or
 *              `parseFloat(...)` on a non-provably-numeric input reaches
 *              arithmetic, a comparison, an index, or `Math.min`/`Math.max`
 *              without a `Number.isFinite` / `isNaN` barrier. `NaN` passes a
 *              `!== undefined` filter and poisons the sink silently. This is
 *              parse-safety class B from the #812 audit (issue #819): the
 *              silent-NaN class an ESLint syntactic rule structurally cannot
 *              detect.
 * @kind path-problem
 * @problem.severity warning
 * @precision medium
 * @id js/parse-safety/silent-nan-to-sink
 * @tags reliability
 *       correctness
 *       parse-safety
 */

import javascript
import NanFlow::PathGraph

/**
 * A numeric coercion of an externally-derived string: `Number(x)`,
 * `parseInt(x, ...)`, `parseFloat(x)`. The sanctioned helpers
 * `numberOrUndefined` / `requireNumber` (src/shared/parse-number.ts) already
 * turn a malformed value into `undefined` or a located throw, so values from
 * them are NOT sources.
 */
class NumericParse extends DataFlow::CallNode {
  NumericParse() {
    this = DataFlow::globalVarRef("Number").getACall()
    or
    this = DataFlow::globalVarRef(["parseInt", "parseFloat"]).getACall()
  }
}

/**
 * A finiteness barrier: `Number.isFinite(x)`, `isFinite(x)`, `Number.isNaN(x)`
 * or `isNaN(x)`. On the branch that establishes the value is a real number,
 * downstream numeric use of it is safe. (`Number.isNaN(x)` / `isNaN(x)` guard
 * on the `false` branch.)
 */
class FiniteBarrierGuard extends DataFlow::CallNode {
  boolean polarity;

  FiniteBarrierGuard() {
    (
      this = DataFlow::globalVarRef("Number").getAMemberCall("isFinite")
      or
      this = DataFlow::globalVarRef("isFinite").getACall()
    ) and
    polarity = true
    or
    (
      this = DataFlow::globalVarRef("Number").getAMemberCall("isNaN")
      or
      this = DataFlow::globalVarRef("isNaN").getACall()
    ) and
    polarity = false
  }

  predicate blocksExpr(boolean outcome, Expr e) {
    e = this.getArgument(0).asExpr() and outcome = polarity
  }
}

/**
 * A numeric sink where a silent `NaN` produces a wrong-but-quiet result:
 * arithmetic, a relational comparison, an array index, or a `Math.min`/
 * `Math.max` argument.
 */
predicate isNumericSink(DataFlow::Node node, string kind) {
  exists(BinaryExpr b |
    b.getAnOperand() = node.asExpr() and
    (
      b instanceof ArithmeticExpr and kind = "arithmetic"
      or
      b instanceof RelationalComparison and kind = "a relational comparison"
    )
  )
  or
  exists(IndexExpr ie | ie.getIndex() = node.asExpr() and kind = "an array index")
  or
  exists(DataFlow::CallNode mc |
    mc = DataFlow::globalVarRef("Math").getAMemberCall(["min", "max"]) and
    mc.getAnArgument() = node and
    kind = "a Math.min/max argument"
  )
}

module NanConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node source) { source instanceof NumericParse }

  predicate isSink(DataFlow::Node sink) { isNumericSink(sink, _) }

  predicate isBarrier(DataFlow::Node node) {
    node = DataFlow::MakeBarrierGuard<FiniteBarrierGuard>::getABarrierNode()
  }
}

module NanFlow = TaintTracking::Global<NanConfig>;

from NanFlow::PathNode source, NanFlow::PathNode sink, string kind
where NanFlow::flowPath(source, sink) and isNumericSink(sink.getNode(), kind)
select sink.getNode(), source, sink,
  "A possibly-NaN parse result reaches " + kind + " without a Number.isFinite/isNaN barrier; the $@ silently poisons the result.",
  source.getNode(), "parsed number"

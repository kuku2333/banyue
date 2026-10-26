// 符号求导：把表达式 AST 按求导法则变形，再序列化成可读的式子。
// 与 derivativeOf()（数值差分）互补：这里给出精确形式，能在界面上显示 f'(x)=2x 这种。
import { parse, type Node } from '@/lib/expr'

/** 转出去给测试与界面直接用 */
export { parse }
export type { Node }

/** 求导失败时抛这个，调用方回落到数值求导 */
export class DiffError extends Error {}

function num(value: number): Node {
  return { kind: 'num', value }
}

function isNum(node: Node, value?: number): boolean {
  return node.kind === 'num' && (value === undefined || Math.abs(node.value - value) < 1e-12)
}

/** 构造加法并做常数折叠 */
function add(a: Node, b: Node): Node {
  if (isNum(a, 0)) return b
  if (isNum(b, 0)) return a
  if (isNum(a) && isNum(b)) return num((a as { value: number }).value + (b as { value: number }).value)
  return { kind: 'binary', op: '+', left: a, right: b }
}

function sub(a: Node, b: Node): Node {
  if (isNum(b, 0)) return a
  if (isNum(a, 0)) return { kind: 'unary', op: '-', operand: b }
  if (isNum(a) && isNum(b)) return num((a as { value: number }).value - (b as { value: number }).value)
  return { kind: 'binary', op: '-', left: a, right: b }
}

function mul(a: Node, b: Node): Node {
  if (isNum(a, 0) || isNum(b, 0)) return num(0)
  if (isNum(a, 1)) return b
  if (isNum(b, 1)) return a
  if (isNum(a) && isNum(b)) return num((a as { value: number }).value * (b as { value: number }).value)
  return { kind: 'binary', op: '*', left: a, right: b }
}

function div(a: Node, b: Node): Node {
  if (isNum(a, 0)) return num(0)
  if (isNum(b, 1)) return a
  return { kind: 'binary', op: '/', left: a, right: b }
}

function pow(base: Node, exp: Node): Node {
  if (isNum(exp, 1)) return base
  if (isNum(exp, 0)) return num(1)
  return { kind: 'binary', op: '^', left: base, right: exp }
}

function call(name: string, ...args: Node[]): Node {
  return { kind: 'call', name, args }
}

/**
 * 对 AST 求导。
 * 只覆盖常见初等函数；遇到不认识的调用就抛错，让调用方回落数值求导。
 */
export function diff(node: Node): Node {
  switch (node.kind) {
    case 'num':
      return num(0)

    case 'var':
      // 目前只有自变量 x
      return num(node.name === 'x' ? 1 : 0)

    case 'unary': {
      const inner = diff(node.operand)
      if (node.op === '-') return { kind: 'unary', op: '-', operand: inner }
      // 其它一元运算（如 +）直接穿透
      return inner
    }

    case 'binary': {
      const { op, left, right } = node
      if (op === '+') return add(diff(left), diff(right))
      if (op === '-') return sub(diff(left), diff(right))
      if (op === '*') {
        // 乘积法则
        return add(mul(diff(left), right), mul(left, diff(right)))
      }
      if (op === '/') {
        // 商法则：(u'v - uv') / v²
        const numerator = sub(mul(diff(left), right), mul(left, diff(right)))
        return div(numerator, pow(right, num(2)))
      }
      if (op === '^') {
        // 幂法则：底是常数时 n·x^(n-1)·x'
        if (isNum(right)) {
          const n = (right as { value: number }).value
          return mul(mul(num(n), pow(left, num(n - 1))), diff(left))
        }
        // 一般情况（底和指数都含 x）：u^v = e^(v·ln u)
        // 导数为 u^v · (v'·ln u + v·u'/u)
        const lnU = call('ln', left)
        const term = add(mul(diff(right), lnU), div(mul(right, diff(left)), left))
        return mul(node, term)
      }
      throw new DiffError(`不支持的运算符「${op}」`)
    }

    case 'call': {
      const inner = node.args[0]
      if (inner === undefined) throw new DiffError(`函数「${node.name}」缺少参数`)
      const u = diff(inner)
      const chain = (outer: Node): Node => mul(outer, u)

      switch (node.name) {
        case 'sin':
          return chain(call('cos', inner))
        case 'cos':
          return chain({ kind: 'unary', op: '-', operand: call('sin', inner) })
        case 'tan':
          // 1/cos²
          return chain(div(num(1), pow(call('cos', inner), num(2))))
        case 'ln':
          return chain(div(num(1), inner))
        case 'log':
        case 'log10':
          // 1/(x·ln10)
          return chain(div(num(1), mul(inner, num(Math.LN10))))
        case 'log2':
          return chain(div(num(1), mul(inner, num(Math.LN2))))
        case 'sqrt':
          // 1/(2√x)
          return chain(div(num(1), mul(num(2), call('sqrt', inner))))
        case 'exp':
          return chain(call('exp', inner))
        case 'asin':
          return chain(div(num(1), call('sqrt', sub(num(1), pow(inner, num(2))))))
        case 'acos':
          return chain({
            kind: 'unary',
            op: '-',
            operand: div(num(1), call('sqrt', sub(num(1), pow(inner, num(2))))),
          })
        case 'atan':
          return chain(div(num(1), add(num(1), pow(inner, num(2)))))
        case 'sinh':
          return chain(call('cosh', inner))
        case 'cosh':
          return chain(call('sinh', inner))
        case 'tanh':
          return chain(sub(num(1), pow(call('tanh', inner), num(2))))
        case 'abs':
          // |x| 在 0 处不可导，写成 x/|x| 并在结果里标注
          throw new DiffError('abs 在 0 处不可导，改用数值导数')
        default:
          throw new DiffError(`暂不支持对「${node.name}」求导`)
      }
    }

    default:
      throw new DiffError('无法识别的表达式结构')
  }
}

/** 优先级，用于决定要不要加括号 */
const PREC: Record<string, number> = {
  '+': 1,
  '-': 1,
  '*': 2,
  '/': 2,
  '^': 3,
}

function needsParens(node: Node, parentPrec: number): boolean {
  if (node.kind !== 'binary') return false
  const own = PREC[node.op] ?? 0
  return own < parentPrec
}

/** 数字格式化：去掉浮点尾巴，保留 6 位有效小数 */
function fmtNum(value: number): string {
  if (Number.isInteger(value)) return String(value)
  const rounded = Math.round(value * 1e6) / 1e6
  return String(rounded)
}

/** 把 AST 序列化成可读的数学式子 */
export function stringify(node: Node): string {
  switch (node.kind) {
    case 'num':
      return fmtNum(node.value)
    case 'var':
      return node.name
    case 'unary':
      return `-${wrap(node.operand, 4)}`
    case 'call':
      return `${node.name}(${node.args.map((arg) => stringify(arg)).join(', ')})`
    case 'binary': {
      const own = PREC[node.op] ?? 0
      const left = wrap(node.left, own)
      // 幂运算右结合，右侧同优先级不加括号
      const right = wrap(node.right, node.op === '^' ? own + 1 : own + 1)
      if (node.op === '*') {
        // 数字贴字母时省略乘号更接近手写习惯：2x 而不是 2*x
        if (node.left.kind === 'num' && node.right.kind !== 'num') return `${left}${right}`
      }
      return `${left}${node.op}${right}`
    }
    default:
      return ''
  }
}

function wrap(node: Node, parentPrec: number): string {
  if (needsParens(node, parentPrec)) return `(${stringify(node)})`
  if (node.kind === 'binary') {
    // 减法/除法的右操作数也要括起来，否则 a-(b+c) 会写成 a-b+c
    return stringify(node)
  }
  return stringify(node)
}

/** 化简：去掉 0 项、合并连续负号，让结果更好读 */
export function simplify(node: Node): Node {
  switch (node.kind) {
    case 'binary': {
      const left = simplify(node.left)
      const right = simplify(node.right)
      if (node.op === '+') return add(left, right)
      if (node.op === '-') return sub(left, right)
      if (node.op === '*') return mul(left, right)
      if (node.op === '/') return div(left, right)
      if (node.op === '^') return pow(left, right)
      return { ...node, left, right }
    }
    case 'unary': {
      const operand = simplify(node.operand)
      if (node.op === '-' && operand.kind === 'unary' && operand.op === '-') return operand.operand
      if (node.op === '-' && isNum(operand)) return num(-(operand as { value: number }).value)
      return { kind: 'unary', op: node.op, operand }
    }
    case 'call':
      return { ...node, args: node.args.map((arg) => simplify(arg)) }
    default:
      return node
  }
}

/**
 * 一步到位：字符串进，求导后的可读式出。
 * 失败返回 error，调用方可以回落到数值求导。
 */
export function differentiate(source: string): { text: string; node?: Node; error?: string } {
  try {
    const ast = parse(source)
    const derived = simplify(diff(ast))
    return { text: stringify(derived), node: derived }
  } catch (error) {
    return { text: '', error: error instanceof Error ? error.message : '求导失败' }
  }
}

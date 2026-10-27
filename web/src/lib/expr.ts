/**
 * 数学表达式解析器与求值器（递归下降）。
 *
 * 支持：
 *  - 运算符：+ - * / ^ ** % （一元正负号）
 *  - 隐式乘法：2x、3sin(x)、x(x+1)、2pi、(x+1)(x-1)
 *  - 函数：sin cos tan asin acos atan sinh cosh tanh
 *          ln log log10 log2 sqrt cbrt abs exp floor ceil round
 *          sign min max（多参数，逗号分隔）
 *  - 常量：pi e tau phi
 *  - 变量：x（绘图自变量），其余字母视为未定义（报错）
 *
 * 另外提供数值导数（中心差分），用于切线/法线斜率。
 */

export interface EvalContext {
  x: number
  t?: number
}

export type MathFunction = (x: number) => number

/** 编译成闭包，可反复求值（绘图时避免每像素都重新解析）。 */
export function compileExpr(source: string): { fn: MathFunction; error?: string } {
  const trimmed = String(source ?? '').trim()
  if (!trimmed) return { fn: () => NaN, error: '表达式为空' }
  try {
    const ast = parse(trimmed)
    return {
      fn: (x: number) => evalNode(ast, { x }),
    }
  } catch (error) {
    return { fn: () => NaN, error: (error as Error).message }
  }
}

/** 一次性求值（带变量上下文）。 */
export function evaluate(source: string, ctx: EvalContext): number {
  const ast = parse(String(source ?? '').trim())
  return evalNode(ast, ctx)
}

/** 数值导数 f'(x)（中心差分，自适应步长）。 */
export function derivativeOf(fn: MathFunction, x: number, h = 1e-6): number {
  const left = fn(x - h)
  const right = fn(x + h)
  if (!Number.isFinite(left) || !Number.isFinite(right)) return NaN
  return (right - left) / (2 * h)
}

/**
 * 定积分数值近似（复合辛普森法）。
 * f 在 [a, b] 上的面积；n 为偶数个子区间数（自动向上取偶）。
 * 遇非有限值返回 NaN。
 */
export function definiteIntegral(fn: MathFunction, a: number, b: number, n = 200): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN
  if (a === b) return 0
  let steps = Math.max(2, Math.floor(n))
  if (steps % 2 === 1) steps += 1
  const h = (b - a) / steps
  let sum = fn(a) + fn(b)
  if (!Number.isFinite(sum)) return NaN
  for (let i = 1; i < steps; i++) {
    const x = a + i * h
    const y = fn(x)
    if (!Number.isFinite(y)) return NaN
    sum += (i % 2 === 0 ? 2 : 4) * y
  }
  return (h / 3) * sum
}

/** 找出函数在 [x0, x0+dir] 上离给定点 (px, py) 最近的点（用于画切线时的切点定位）。 */
export function nearestPoint(
  fn: MathFunction,
  px: number,
  py: number,
  x0: number,
  dir: 1 | -1,
  steps = 200,
): { x: number; y: number } | null {
  let best: { x: number; y: number; d: number } | null = null
  for (let i = 0; i <= steps; i++) {
    const x = x0 + dir * ((i / steps) * 5)
    const y = fn(x)
    if (!Number.isFinite(y)) continue
    const d = (x - px) ** 2 + (y - py) ** 2
    if (!best || d < best.d) best = { x, y, d }
  }
  return best ? { x: best.x, y: best.y } : null
}

/* ---------------- 解析器 ---------------- */

export type Node =
  | { kind: 'num'; value: number }
  | { kind: 'var'; name: string }
  | { kind: 'unary'; op: string; operand: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[] }

export const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
  phi: (1 + Math.sqrt(5)) / 2,
}

/** 单参数函数 */
export const FUNC1: Record<string, MathFunction> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  ln: Math.log,
  log: Math.log10,
  log10: Math.log10,
  log2: Math.log2,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
}

const FUNC_MULTI = new Set(['min', 'max'])

class ParseError extends Error {}

function tokenize(src: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++
      continue
    }
    // 数字（含小数、科学计数法）
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++
      if (j < src.length && /[eE]/.test(src[j]!)) {
        let k = j + 1
        if (src[k] === '+' || src[k] === '-') k++
        while (k < src.length && /[0-9]/.test(src[k]!)) k++
        j = k
      }
      tokens.push(src.slice(i, j))
      i = j
      continue
    }
    // 标识符（函数名/常量/变量）
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i
      while (j < src.length && /[a-zA-Z_0-9]/.test(src[j]!)) j++
      tokens.push(src.slice(i, j))
      i = j
      continue
    }
    // 运算符
    if (src.startsWith('**', i)) {
      tokens.push('**')
      i += 2
      continue
    }
    tokens.push(ch)
    i++
  }
  return tokens
}

class Parser {
  private pos = 0
  constructor(private tokens: string[]) {}

  private peek(): string | undefined {
    return this.tokens[this.pos]
  }
  private next(): string | undefined {
    return this.tokens[this.pos++]
  }
  private expect(value: string): void {
    if (this.next() !== value) throw new ParseError(`缺少「${value}」`)
  }

  parse(): Node {
    if (!this.tokens.length) throw new ParseError('表达式为空')
    const node = this.parseAddSub()
    if (this.pos < this.tokens.length) {
      throw new ParseError(`「${this.tokens[this.pos]}」附近有无法解析的内容`)
    }
    return node
  }

  private parseAddSub(): Node {
    let left = this.parseMulDiv()
    for (;;) {
      const op = this.peek()
      if (op === '+' || op === '-') {
        this.next()
        const right = this.parseMulDiv()
        left = { kind: 'binary', op, left, right }
      } else {
        return left
      }
    }
  }

  private parseMulDiv(): Node {
    let left = this.parseUnary()
    for (;;) {
      const op = this.peek()
      if (op === '*' || op === '/' || op === '%') {
        this.next()
        const right = this.parseUnary()
        left = { kind: 'binary', op, left, right }
      } else if (this.isImplicitMulStart()) {
        // 隐式乘法：2x、x(x+1)、3sin(x)、2pi
        const right = this.parseUnary()
        left = { kind: 'binary', op: '*', left, right }
      } else {
        return left
      }
    }
  }

  /** 判断当前位置是否应视为隐式乘法的右操作数起点 */
  private isImplicitMulStart(): boolean {
    const t = this.peek()
    if (!t) return false
    if (/[0-9]/.test(t) || t === '(') return true
    // 标识符：只有当它是变量/常量/函数名时才隐式乘
    if (/^[a-zA-Z_]/.test(t)) {
      const name = t.toLowerCase()
      if (name === 'x' || name in CONSTANTS || name in FUNC1 || FUNC_MULTI.has(name)) return true
    }
    return false
  }

  private parseUnary(): Node {
    const op = this.peek()
    if (op === '+' || op === '-') {
      this.next()
      const operand = this.parseUnary()
      return { kind: 'unary', op, operand }
    }
    return this.parsePower()
  }

  private parsePower(): Node {
    const base = this.parseAtom()
    const op = this.peek()
    if (op === '^' || op === '**') {
      this.next()
      // 幂右结合，且允许负指数（x^-2 也成立）
      const exponent = this.parseUnary()
      return { kind: 'binary', op: '^', left: base, right: exponent }
    }
    return base
  }

  private parseAtom(): Node {
    const t = this.next()
    if (t === undefined) throw new ParseError('表达式不完整')
    if (t === '(') {
      const node = this.parseAddSub()
      this.expect(')')
      return node
    }
    if (/^[0-9]/.test(t) || (t.startsWith('.') && t.length > 1)) {
      const value = Number(t)
      if (Number.isNaN(value)) throw new ParseError(`「${t}」不是合法数字`)
      return { kind: 'num', value }
    }
    if (/^[a-zA-Z_]/.test(t)) {
      const lower = t.toLowerCase()
      // 函数调用：只有真正的函数名才按调用处理；x(...) 应视为隐式乘法 x*(...)
      if (this.peek() === '(' && (lower in FUNC1 || FUNC_MULTI.has(lower))) {
        this.next()
        const args: Node[] = []
        if (this.peek() !== ')') {
          for (;;) {
            args.push(this.parseAddSub())
            if (this.peek() === ',') {
              this.next()
              continue
            }
            break
          }
        }
        this.expect(')')
        return { kind: 'call', name: lower, args }
      }
      if (lower === 'x') return { kind: 'var', name: 'x' }
      if (lower in CONSTANTS) return { kind: 'num', value: CONSTANTS[lower]! }
      throw new ParseError(`未知的变量或函数「${t}」（自变量只能用 x）`)
    }
    throw new ParseError(`无法理解「${t}」`)
  }
}

export function parse(src: string): Node {
  const tokens = tokenize(src)
  if (!tokens.length) throw new ParseError('表达式为空')
  return new Parser(tokens).parse()
}

function evalNode(node: Node, ctx: EvalContext): number {
  switch (node.kind) {
    case 'num':
      return node.value
    case 'var':
      if (node.name === 'x') return ctx.x
      return NaN
    case 'unary':
      return node.op === '-' ? -evalNode(node.operand, ctx) : evalNode(node.operand, ctx)
    case 'binary': {
      const left = evalNode(node.left, ctx)
      const right = evalNode(node.right, ctx)
      switch (node.op) {
        case '+':
          return left + right
        case '-':
          return left - right
        case '*':
          return left * right
        case '/':
          return left / right
        case '%':
          return left % right
        case '^':
          return Math.pow(left, right)
        default:
          return NaN
      }
    }
    case 'call': {
      const args = node.args.map((arg) => evalNode(arg, ctx))
      if (node.name in FUNC1) {
        return FUNC1[node.name]!(args[0]!)
      }
      if (node.name === 'min') return Math.min(...args)
      if (node.name === 'max') return Math.max(...args)
      return NaN
    }
  }
}

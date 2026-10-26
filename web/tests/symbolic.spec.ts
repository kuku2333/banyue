import { describe, expect, it } from 'vitest'
import { differentiate, diff, parse, simplify, stringify } from '@/lib/symbolic'
import { evaluate } from '@/lib/expr'

/** 用数值导数校验符号求导结果是否正确 */
function checkNumerically(source: string, x: number, tolerance = 1e-4): void {
  const result = differentiate(source)
  expect(result.error, `${source} 求导失败: ${result.error}`).toBeUndefined()
  const h = 1e-6
  const numeric =
    (evaluate(source, { x: x + h }) - evaluate(source, { x: x - h })) / (2 * h)
  const symbolic = evaluate(result.text, { x })
  expect(Math.abs(symbolic - numeric)).toBeLessThan(tolerance)
}

describe('多项式求导', () => {
  it('常数导数为 0', () => {
    expect(differentiate('5').text).toBe('0')
  })

  it('x 的导数为 1', () => {
    expect(differentiate('x').text).toBe('1')
  })

  it('x^2 的导数为 2x', () => {
    expect(differentiate('x^2').text).toBe('2x')
  })

  it('x^3 的导数为 3x^2', () => {
    expect(differentiate('x^3').text).toBe('3x^2')
  })

  it('2x+1 的导数为 2', () => {
    expect(differentiate('2x+1').text).toBe('2')
  })

  it('x^2+x 的导数数值正确', () => {
    checkNumerically('x^2+x', 3)
  })

  it('多项式组合数值正确', () => {
    checkNumerically('3x^3-2x^2+5x-7', 2)
  })
})

describe('初等函数求导', () => {
  it('sin(x) → cos(x)', () => {
    expect(differentiate('sin(x)').text).toBe('cos(x)')
  })

  it('cos(x) → -sin(x)', () => {
    expect(differentiate('cos(x)').text).toContain('sin(x)')
  })

  it('ln(x) → 1/x', () => {
    expect(differentiate('ln(x)').text).toBe('1/x')
  })

  it('exp(x) → exp(x)', () => {
    expect(differentiate('exp(x)').text).toBe('exp(x)')
  })

  it('sqrt(x) 数值正确', () => {
    checkNumerically('sqrt(x)', 4)
  })

  it('tan(x) 数值正确', () => {
    checkNumerically('tan(x)', 0.5)
  })

  it('atan(x) 数值正确', () => {
    checkNumerically('atan(x)', 1.5)
  })
})

describe('链式法则', () => {
  it('sin(2x) 数值正确', () => {
    checkNumerically('sin(2x)', 1)
  })

  it('sin(x^2) 数值正确', () => {
    checkNumerically('sin(x^2)', 1.2)
  })

  it('exp(3x) 数值正确', () => {
    checkNumerically('exp(3x)', 0.5)
  })

  it('ln(x^2+1) 数值正确', () => {
    checkNumerically('ln(x^2+1)', 2)
  })

  it('sqrt(x^2+1) 数值正确', () => {
    checkNumerically('sqrt(x^2+1)', 1)
  })
})

describe('乘除法则', () => {
  it('乘积法则：x*sin(x)', () => {
    checkNumerically('x*sin(x)', 1.5)
  })

  it('商法则：sin(x)/x', () => {
    checkNumerically('sin(x)/x', 2)
  })

  it('商法则：x/(x^2+1)', () => {
    checkNumerically('x/(x^2+1)', 0.7)
  })

  it('乘积+链式：x^2*exp(x)', () => {
    checkNumerically('x^2*exp(x)', 1)
  })
})

describe('不支持的输入', () => {
  it('abs 返回错误而不是崩', () => {
    const result = differentiate('abs(x)')
    expect(result.error).toBeTruthy()
    expect(result.text).toBe('')
  })

  it('语法错误的表达式返回错误', () => {
    const result = differentiate('sin(')
    expect(result.error).toBeTruthy()
  })
})

describe('simplify 与 stringify', () => {
  it('去掉加 0', () => {
    const node = simplify({
      kind: 'binary',
      op: '+',
      left: parse('x'),
      right: { kind: 'num', value: 0 },
    })
    expect(stringify(node)).toBe('x')
  })

  it('乘 1 不改变结果', () => {
    const node = simplify({
      kind: 'binary',
      op: '*',
      left: { kind: 'num', value: 1 },
      right: parse('x^2'),
    })
    expect(stringify(node)).toBe('x^2')
  })

  it('乘 0 变 0', () => {
    const node = simplify({
      kind: 'binary',
      op: '*',
      left: { kind: 'num', value: 0 },
      right: parse('x'),
    })
    expect(stringify(node)).toBe('0')
  })

  it('数字贴变量省略乘号', () => {
    expect(stringify(parse('2x'))).toBe('2x')
  })
})

describe('diff 直接调用', () => {
  it('对常量节点求导是 0', () => {
    expect(stringify(diff({ kind: 'num', value: 42 }))).toBe('0')
  })
})

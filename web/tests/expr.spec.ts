import { describe, expect, it } from 'vitest'
import { compileExpr, derivativeOf, evaluate } from '@/lib/expr'

describe('表达式解析器', () => {
  it('基本四则运算', () => {
    expect(evaluate('1+2*3', { x: 0 })).toBe(7)
    expect(evaluate('(1+2)*3', { x: 0 })).toBe(9)
    expect(evaluate('10/4', { x: 0 })).toBe(2.5)
    expect(evaluate('10%3', { x: 0 })).toBe(1)
  })

  it('幂运算与一元正负号', () => {
    expect(evaluate('2^10', { x: 0 })).toBe(1024)
    expect(evaluate('2**3', { x: 0 })).toBe(8)
    expect(evaluate('-3+5', { x: 0 })).toBe(2)
    expect(evaluate('2^-2', { x: 0 })).toBe(0.25)
    expect(evaluate('(-3)^2', { x: 0 })).toBe(9)
  })

  it('隐式乘法', () => {
    expect(evaluate('2x', { x: 3 })).toBe(6)
    expect(evaluate('3sin(x)', { x: Math.PI / 2 })).toBeCloseTo(3)
    expect(evaluate('2pi', { x: 0 })).toBeCloseTo(2 * Math.PI)
    expect(evaluate('x(x+1)', { x: 2 })).toBe(6)
    expect(evaluate('(x+1)(x-1)', { x: 3 })).toBe(8)
  })

  it('函数与常量', () => {
    expect(evaluate('sin(0)', { x: 0 })).toBe(0)
    expect(evaluate('cos(0)', { x: 0 })).toBe(1)
    expect(evaluate('sqrt(16)', { x: 0 })).toBe(4)
    expect(evaluate('abs(-5)', { x: 0 })).toBe(5)
    expect(evaluate('ln(e)', { x: 0 })).toBeCloseTo(1)
    expect(evaluate('log(100)', { x: 0 })).toBeCloseTo(2)
    expect(evaluate('min(3,5,1)', { x: 0 })).toBe(1)
    expect(evaluate('max(3,5,1)', { x: 0 })).toBe(5)
  })

  it('编译后反复求值', () => {
    const { fn, error } = compileExpr('x^2 - 2x + 1')
    expect(error).toBeUndefined()
    expect(fn(0)).toBe(1)
    expect(fn(1)).toBe(0)
    expect(fn(3)).toBe(4)
  })

  it('错误处理', () => {
    expect(compileExpr('').error).toBeTruthy()
    expect(compileExpr('y+1').error).toBeTruthy()
    expect(compileExpr('sin(x').error).toBeTruthy()
    expect(compileExpr('x @ 2').error).toBeTruthy()
  })
})

describe('数值导数', () => {
  it('f(x)=x^2 的导数是 2x', () => {
    const { fn } = compileExpr('x^2')
    expect(derivativeOf(fn, 1)).toBeCloseTo(2, 3)
    expect(derivativeOf(fn, -3)).toBeCloseTo(-6, 2)
  })

  it('f(x)=sin(x) 的导数是 cos(x)', () => {
    const { fn } = compileExpr('sin(x)')
    expect(derivativeOf(fn, 0)).toBeCloseTo(1, 3)
    expect(derivativeOf(fn, Math.PI / 2)).toBeCloseTo(0, 3)
  })
})

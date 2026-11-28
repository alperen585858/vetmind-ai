import { createElement, isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { createTranslator } from '../../i18n'
import { ErrorBoundary } from './ErrorBoundary'

vi.mock('../shell/LocaleContext', () => ({
  useLocale: () => ({ locale: 'tr', t: createTranslator('tr') }),
}))

it('renders children until something throws, then the crash card (#124)', () => {
  const b = new ErrorBoundary({ children: createElement('p', null, 'page'), resetKey: '/a' })
  expect(renderToStaticMarkup(b.render() as never)).toBe('<p>page</p>')

  b.state = ErrorBoundary.getDerivedStateFromError(new Error('boom'))
  const out = b.render()
  expect(isValidElement(out)).toBe(true)
  const html = renderToStaticMarkup(out as never)
  expect(html).toContain('role="alert"')
  expect(html).toContain('Bir şeyler ters gitti')
  expect(html).toContain('Sayfayı yenile')
  expect(html).not.toContain('boom') // no raw error text for users
})

it('clears the error when the user navigates (resetKey changes)', () => {
  const b = new ErrorBoundary({ children: null, resetKey: '/b' })
  b.state = { error: new Error('boom') }
  const setState = vi.fn()
  b.setState = setState as never
  b.componentDidUpdate({ resetKey: '/b' })
  expect(setState).not.toHaveBeenCalled()
  b.componentDidUpdate({ resetKey: '/a' })
  expect(setState).toHaveBeenCalledWith({ error: null })
})

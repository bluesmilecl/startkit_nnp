import { describe, expect, it } from 'vitest';
import { sanitizeEmailHtml } from './templates.js';

describe('generated e-mail HTML', () => {
  it('drops scripts, frames, forms, inline handlers and javascript: links', () => {
    const html = sanitizeEmailHtml(
      '<p onclick="steal()">Hola</p><script>alert(1)</script><iframe src="x"></iframe><form action="/x"><input></form><a href="javascript:alert(1)">x</a><img src="https://a.cl/l.png" onerror=alert(1)>',
    );
    expect(html).toBe('<p>Hola</p><a href="#">x</a><img src="https://a.cl/l.png">');
  });
});

export function fillOtpField(code) {
  const pattern = /(one.?time|otp|totp|2fa|mfa|two.?factor|auth(?:entication|enticator)?.*(?:code|token)|verif(?:y|ication).*(?:code|token)|security.?code|login.?code|access.?code|dynamic.?code|passcode|验证码|动态码|动态密码|校验码|口令|令牌)/i;
  const candidates = [];

  document.querySelectorAll('input').forEach((input) => {
    const type = (input.type || 'text').toLowerCase();
    if (!['text', 'tel', 'number'].includes(type)) {
      return;
    }
    if (input.disabled || input.readOnly) {
      return;
    }

    const rect = input.getBoundingClientRect();
    const style = getComputedStyle(input);
    if (
      rect.width < 6
      || rect.height < 6
      || style.visibility === 'hidden'
      || style.display === 'none'
      || style.opacity === '0'
    ) {
      return;
    }

    const haystack = [
      input.name,
      input.id,
      input.placeholder,
      input.getAttribute('aria-label'),
      input.getAttribute('autocomplete'),
      input.className,
    ].filter(Boolean).join(' ');

    const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();
    let score = 0;
    if (autocomplete === 'one-time-code') {
      score += 150;
    }
    if (pattern.test(haystack)) {
      score += 60;
    }
    if (type === 'tel' || type === 'number' || input.inputMode === 'numeric') {
      score += 15;
    }
    const maxLength = Number(input.maxLength);
    if (maxLength >= 4 && maxLength <= 10) {
      score += 20;
    }
    if (input === document.activeElement) {
      score += 30;
    }

    candidates.push({ input, score });
  });

  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0];
  if (!winner || winner.score < 60) {
    return false;
  }

  const input = winner.input;
  const value = String(code).replace(/\s+/g, '');
  input.focus();

  try {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
  } catch {
    input.value = value;
  }

  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: '0', code: 'Digit0' }));
  return true;
}

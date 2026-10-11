// ─────────────────────────────────────────────────────────────
// React Native style primitives — zero dependencies, tiny runtime.
// Mirrors RN's component model: declarative elements, one-way data
// flow, mount-based rendering to plain DOM (no React runtime).
// ─────────────────────────────────────────────────────────────

window.Astarix = window.Astarix || {};

(function (A) {
  function createElement(type, props, ...children) {
    // Resolve function components (View/Text/Pressable) into element trees.
    if (typeof type === 'function') return type(props, ...children);
    return { type, props: props || {}, children: children.flat(Infinity).filter(Boolean) };
  }

  function renderNode(node) {
    if (node == null || node === false) return document.createComment('empty');
    if (typeof node === 'string' || typeof node === 'number') return document.createTextNode(String(node));

    const { type, props, children } = node;

    if (type === Fragment) {
      const frag = document.createDocumentFragment();
      children.forEach(c => frag.appendChild(renderNode(c)));
      return frag;
    }

    const dom = document.createElement(type);
    const { className, style, onClick, onInput, onChange, onKeyDown, ref, value, checked, text, ...rest } = props || {};

    if (className) dom.className = className;
    if (style) Object.assign(dom.style, style);
    if (text !== undefined) dom.textContent = text;
    if (value !== undefined) dom.value = value;
    if (checked !== undefined) dom.checked = !!checked;
    if (type === 'img') { dom.loading = 'lazy'; dom.decoding = 'async'; }

    if (onClick) dom.addEventListener('click', onClick);
    if (onInput) dom.addEventListener('input', onInput);
    if (onChange) dom.addEventListener('change', onChange);
    if (onKeyDown) dom.addEventListener('keydown', onKeyDown);

    for (const k in rest) {
      const v = rest[k];
      if (v == null || v === false) continue;
      if (k.startsWith('on')) continue;
      try { dom.setAttribute(k, v === true ? '' : String(v)); } catch (_) {}
    }

    if (typeof ref === 'function') ref(dom);

    children.forEach(c => dom.appendChild(renderNode(c)));
    return dom;
  }

  function mount(el, host) {
    host.textContent = '';
    host.appendChild(renderNode(el));
    return host;
  }

  const Fragment = Symbol('fragment');

  const View = (props, ...children) => createElement('div', props, ...children);
  const Text = (props, ...children) => createElement('span', props, ...children);
  const Pressable = (props, ...children) =>
    createElement('div', Object.assign({ role: 'button', tabindex: '0' }, props), ...children);
  const Image = (props) => createElement('img', props);
  const ScrollView = (props, ...children) =>
    createElement('div', Object.assign({ style: { overflowY: 'auto' } }, props), ...children);

  A.rn = { createElement, mount, renderNode, Fragment, View, Text, Pressable, Image, ScrollView, h: createElement };
})(window.Astarix);
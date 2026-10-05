type Child = Node | string | null | undefined | false;
type Props = {
  class?: string;
  text?: string;
  title?: string;
  [attribute: `data-${string}`]: string;
  [attribute: `aria-${string}`]: string;
  role?: string;
  type?: string;
  lang?: string;
  hidden?: boolean;
  tabindex?: string;
};

/** Create an element with attributes and children; strings become text nodes. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (name === 'class') element.className = String(value);
    else if (name === 'text') element.textContent = String(value);
    else if (name === 'hidden') element.hidden = Boolean(value);
    else element.setAttribute(name, String(value));
  }
  for (const child of children)
    if (child !== null && child !== undefined && child !== false)
      element.append(typeof child === 'string' ? document.createTextNode(child) : child);
  return element;
}

/** Set text only when it differs, so screen readers and selections are not disturbed. */
export function setText(element: Element, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

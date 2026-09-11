import type { Evidence, Extraction, Item } from "./types";

/** Splits an item's text around its first extracted quote span. */
export function evidenceFromItem(item: Item, extraction?: Extraction): Evidence {
  const span = extraction?.quotes[0];
  if (!span || item.text.slice(span.start, span.end) !== span.text) {
    return { itemId: item.id, pre: "", quote: item.text, post: "" };
  }
  return {
    itemId: item.id,
    pre: item.text.slice(0, span.start),
    quote: span.text,
    post: item.text.slice(span.end),
  };
}

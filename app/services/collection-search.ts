export function buildCollectionSearch(search: string) {
  if (!search) return null;

  // Shopify treats a wildcard inside quotes as literal phrase text, so
  // title:"men*" does not find "Men's Collection". Build one unquoted,
  // escaped title-prefix clause per search term instead. Multiple terms are
  // combined with AND by Shopify and can match anywhere in the title.
  const terms = search.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return null;

  return terms
    .map((term) => {
      const escaped = term
        .replace(/\\/g, "\\\\")
        .replace(/([():*"])/g, "\\$1");
      return `title:${escaped}*`;
    })
    .join(" ");
}

# Branded Search Improvement Checklist for IPEC Consulting

To improve visibility for "IPEC Expense Manager" and "IPEC Consulting" and resolve entity conflicts, follow this checklist:

## 1. Entity Disambiguation (Schema)
- [ ] **Organization Schema**: Ensure all subdomains (Netlify, etc.) have the `Organization` schema pointing to `https://i.fouralpha.org/` (Primary Domain) and `https://ipecconsulting.org/` (Primary Entity) as the key entities.
- [ ] **sameAs Links**: Add `https://ipecconsulting.org/`, social media profiles (LinkedIn, Twitter), and official subdomains to the `sameAs` array in the `Organization` schema.

## 2. Authority Consolidation
- [ ] **Canonical Tags**: On all entry points, ensure `<link rel="canonical" href="https://i.fouralpha.org/">` is correctly set.
- [ ] **Link Consolidation**: If you have multiple landing pages, ensure they all point to `https://i.fouralpha.org/` as the primary home for the Expense Manager.

## 3. Google Business Profile (GBP)
- [ ] **Featured Products**: Add "IPEC Expense Manager" as a 'Product' in your Google Business Profile dashboard. This helps it appear in the Knowledge Panel. Link it to `https://i.fouralpha.org/`.
- [ ] **Service Area**: Define the service area clearly to avoid being confused with international commissions (like IPEC Zimbabwe).

## 4. Rich Snippets
- [ ] **Sitelink Searchbox**: Ensure the `WebSite` schema includes a `potentialAction` for search to enable the search box in search results.
- [ ] **Breadcrumbs**: Implement `BreadcrumbList` schema on all pages to improve the visual snippet.

## 5. Branded Content
- [ ] **About Page**: Create a dedicated "About IPEC Consulting" page on the main domain that clearly defines the organization's scope.
- [ ] **Logo Alt Text**: Ensure all logos have `alt="IPEC Consulting Logo"` or similar branded text.

import os
import json
import re
import argparse

def inject_schema(directory, same_as_url, main_domain):
    """
    Injects Organization and WebSite JSON-LD schema into HTML files.
    """
    org_schema = {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": "IPEC Consulting",
        "url": main_domain,
        "logo": f"{main_domain}/assets/images/cropped-ipec-logo-32x32.png",
        "sameAs": [
            same_as_url,
            "https://www.linkedin.com/company/ipec-consulting/",
            "https://twitter.com/ipecconsulting"
        ]
    }

    website_schema = {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": "IPEC Expense Manager",
        "url": main_domain,
        "publisher": {
            "@id": f"{main_domain}/#organization"
        },
        "potentialAction": {
            "@type": "SearchAction",
            "target": f"{main_domain}/search?q={{search_term_string}}",
            "query-input": "required name=search_term_string"
        }
    }

    # Add @id to link them
    org_schema["@id"] = f"{main_domain}/#organization"

    schemas_to_inject = [org_schema, website_schema]
    json_ld_string = "\n".join([
        f'<script type="application/ld+json">\n{json.dumps(s, indent=2)}\n</script>'
        for s in schemas_to_inject
    ])

    for root, dirs, files in os.walk(directory):
        # Exclude node_modules and hidden directories
        dirs[:] = [d for d in dirs if not d.startswith('.') and d != 'node_modules']
        for file in files:
            if file.endswith(".html"):
                file_path = os.path.join(root, file)
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()

                # Avoid duplicate injection
                if 'application/ld+json' in content and '"@type": "Organization"' in content:
                    print(f"Skipping {file_path}: Schema already exists.")
                    continue

                # Inject before </head> or </body>
                if "</head>" in content:
                    new_content = content.replace("</head>", f"{json_ld_string}\n</head>")
                elif "</body>" in content:
                    new_content = content.replace("</body>", f"{json_ld_string}\n</body>")
                else:
                    new_content = content + f"\n{json_ld_string}"

                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                print(f"Injected schema into {file_path}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Batch inject JSON-LD schema into HTML files.")
    parser.add_argument("--dir", default=".", help="Directory to process")
    parser.add_argument("--sameAs", default="https://ipecconsulting.org/", help="Primary entity URL for sameAs")
    parser.add_argument("--domain", default="https://i.fouralpha.org", help="Main domain URL")

    args = parser.parse_args()
    inject_schema(args.dir, args.sameAs, args.domain)

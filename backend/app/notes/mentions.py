import re

MENTION = re.compile(r"<#[0-9a-f-]{36}\|([^>\n]*)>")


def readable(content: str) -> str:
    """Show stored channel mentions (<#id|name>) as #name in plain-text places."""
    return MENTION.sub(r"#\1", content)

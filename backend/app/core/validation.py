from typing import Annotated

from pydantic import StringConstraints

Name = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=80),
]

Username = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=64,
        pattern=r"^[\w.\- ]+$",
    ),
]

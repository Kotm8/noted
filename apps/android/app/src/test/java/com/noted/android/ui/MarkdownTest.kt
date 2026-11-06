package com.noted.android.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class MarkdownTest {
    @Test fun enterContinuesCheckboxAndPreservesIndentation() {
        assertEquals("- [ ] Read\n- [ ] ", continueTask("- [ ] Read", "- [ ] Read\n"))
        assertEquals("  - [x] Read\n  - [ ] ", continueTask("  - [x] Read", "  - [x] Read\n"))
        assertEquals("- [ ] Read\n- [ ] next", continueTask("- [ ] Readnext", "- [ ] Read\nnext"))
        assertEquals("\n", continueTask("- [ ] ", "- [ ] \n"))
        assertEquals("Plain\n", continueTask("Plain", "Plain\n"))
    }

    @Test fun checkingAnItemChangesOnlyTheSelectedLine() {
        assertEquals("- [ ] One\n- [x] Two", toggleTask("- [ ] One\n- [ ] Two", 1, true))
        assertEquals("- [ ] One\n- [ ] Two", toggleTask("- [x] One\n- [ ] Two", 0, false))
    }
}

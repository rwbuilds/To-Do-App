// In-note Find shows "k/N" and Next moves k; Markdown export keeps tables; an add-bar chip's
// tooltip shows the full value.
'use strict';
const { open, checker } = require('./helpers');
const { check, done } = checker('find, markdown and chips');

const seed = {
    groups: ['Household errands and chores'], sections: { 'Household errands and chores': ["Dad's very long list of things"] },
    settings: { theme: 'purple' }, todos: [],
    notes: [{ id: 'n1abc', title: 'Pie', body: 'x', bodyHtml: '<p>apple pie</p><p>Apple jam and apple tart</p>', updatedAt: new Date().toISOString() }],
};
const j = open(process.argv[2], { seed });
const { w, doc } = j;

// jsdom has no window.find. This stand-in selects the next match inside the note, wrapping at the end.
w.find = (term) => {
    const body = doc.getElementById('noteBody');
    const walker = doc.createTreeWalker(body, w.NodeFilter.SHOW_TEXT);
    const nodes = [];
    let all = '';
    for (let n; (n = walker.nextNode());) { nodes.push([n, all.length]); all += n.data; }
    const sel = w.getSelection();
    let from = 0;
    if (sel.rangeCount) {
        const r = sel.getRangeAt(0);
        const hit = nodes.find(([n]) => n === r.endContainer);
        if (hit) from = hit[1] + r.endOffset;
    }
    const low = all.toLowerCase(), t = term.toLowerCase();
    let i = low.indexOf(t, from);
    if (i < 0) i = low.indexOf(t);
    if (i < 0) return false;
    const at = pos => { for (let k = nodes.length - 1; k >= 0; k--) if (pos >= nodes[k][1]) return [nodes[k][0], pos - nodes[k][1]]; };
    const r = doc.createRange();
    const [sn, so] = at(i), [en, eo] = at(i + term.length);
    r.setStart(sn, so); r.setEnd(en, eo);
    sel.removeAllRanges(); sel.addRange(r);
    return true;
};

// Find
w.switchTab('notes');
w.openNoteEditor('n1abc');
w.openNoteFind();
const count = () => doc.getElementById('noteFindCount').textContent;
doc.getElementById('noteFindInput').value = 'apple';
w.noteFind();
check('Find shows 1/3 for the first match', count() === '1/3', count());
w.noteFindNext();
check('Next shows 2/3', count() === '2/3', count());
check('the second match is selected', w.getSelection().toString() === 'Apple', JSON.stringify(w.getSelection().toString()));
w.noteFindNext();
check('Next shows 3/3', count() === '3/3', count());
w.noteFindNext();
check('Next after the last match wraps to 1/3', count() === '1/3', count());
doc.getElementById('noteFindInput').value = 'banana';
w.noteFind();
check('no match shows 0/0', count() === '0/0', count());
w.closeNoteEditor();

// Markdown export of a table
const el = doc.createElement('div');
el.innerHTML = '<p>Before</p><table><tr><td>Name</td><td>Qty</td></tr><tr><td><b>Apples</b></td><td>3</td></tr>' +
    '<tr><td>Pears | ripe</td><td>&nbsp;</td></tr></table><div><table><tr><td>A</td></tr><tr><td>B</td></tr></table></div><p>After</p>';
const md = w.htmlToMarkdown(el);
const want = ['Before', '| Name | Qty |', '| --- | --- |', '| **Apples** | 3 |', '| Pears \\| ripe |  |', '',
    '| A |', '| --- |', '| B |', '', 'After', ''].join('\n');
check('tables export as Markdown rows', md === want, JSON.stringify(md));

// Chip tooltip shows the full value
w.switchTab('todos');
const g = doc.getElementById('groupSelect'), s = doc.getElementById('sectionSelect');
g.value = 'Household errands and chores';
g.dispatchEvent(new w.Event('change'));
s.value = "Dad's very long list of things";
w.renderAddChips();
const chip = doc.querySelector('#addChips [data-for="sectionSelect"]');
check('the section chip\'s tooltip shows the full name', !!chip && chip.title === "Section: Dad's very long list of things", chip && chip.title);
const gchip = doc.querySelector('#addChips [data-for="groupSelect"]');
check('the group chip\'s tooltip shows the full name', !!gchip && gchip.title === 'Group: Household errands and chores', gchip && gchip.title);
check('chips keep their screen-reader label', !!chip && chip.getAttribute('aria-label') === 'Next task section');
check('no script errors', j.errors.length === 0, j.errors.slice(0, 2).join(' | '));
done();

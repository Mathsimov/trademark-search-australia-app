(() => {
    const {
        useState,
        useEffect,
        useRef
    } = React;

    function App() {
        // List of completed chips. Each chip represents a single search term.
        const [chips, setChips] = useState([]);
        // Current value in the input before it becomes a chip.
        const [inputValue, setInputValue] = useState('');
        // Prefetched data for each chip. When a chip is created, we
        // automatically query the server in the background so that the
        // subsequent search is almost instantaneous. Keys correspond to the
        // chip value and values are the server‑returned info object.
        const [prefetchCache, setPrefetchCache] = useState({});
        // Results displayed after the user explicitly clicks the search button.
        const [results, setResults] = useState(null);
        const [loading, setLoading] = useState(false);
        const [error, setError] = useState(null);

        // Reference to the underlying input element so we can focus it on container clicks.
        const inputRef = useRef(null);

        // Indices of currently selected chips for visual highlighting. This
        // supports both Ctrl+A selection and click‑drag selection.
        const [selectedIndices, setSelectedIndices] = useState(new Set());
        // Whether the user is actively dragging to select chips.
        const [dragSelecting, setDragSelecting] = useState(false);

        // Track whether the mouse button is currently pressed on a chip and the
        // index where it started. This allows us to distinguish between a
        // simple click (edit) and a drag (selection). If the user presses
        // down and releases on the same chip without dragging over others,
        // we treat it as a click to edit. Otherwise it becomes a selection.
        const [mouseDownFlag, setMouseDownFlag] = useState(false);
        const [mouseDownIndex, setMouseDownIndex] = useState(null);

        // Track whether each result card is expanded to show all trademark
        // filings. The keys are the search names and values are booleans.
        const [expandedCards, setExpandedCards] = useState({});

        /**
         * Toggle the expanded state for a particular search card. When
         * expanded, all trademark filings including lower priority classes
         * (i.e. not 028, 041 or 009) are displayed. Otherwise only the
         * highest priority classes (028, 041, then 009) are shown.
         *
         * @param {string} name The search name (key in results)
         */
        function toggleExpand(name) {
            setExpandedCards(prev => ({ ...prev, [name]: !prev[name] }));
        }

        /**
         * Remove all currently selected chips. This helper uses the
         * selectedIndices state to filter out the chips array and
         * clears the selection afterwards. It is used when the user
         * presses Backspace/Delete or starts typing while one or more
         * chips are highlighted.
         */
        function removeSelectedChips() {
            // If nothing is selected, no work is required.
            if (!selectedIndices || selectedIndices.size === 0) return;
            // Remove chips whose indices are in selectedIndices
            setChips(prev => prev.filter((_, idx) => !selectedIndices.has(idx)));
            // Clear the selection state
            setSelectedIndices(new Set());
        }

        /**
         * Finalise the current input text and convert it into a chip. A chip is
         * created when the user presses comma, Enter or when the input loses
         * focus. Duplicate values are ignored. Leading/trailing whitespace is
         * trimmed.
         */
        function finalizeInput() {
            const val = inputValue.trim();
            if (!val) return;
            setChips(prev => {
                // Avoid duplicate chips; if duplicates are desired just remove this check
                if (prev.includes(val)) {
                    return prev;
                }
                return [...prev, val];
            });
            setInputValue('');
        }

        /**
         * Handle key presses inside the tag input. Comma and Enter both commit
         * the current value into a chip. Prevent default behaviour to avoid
         * inserting commas or submitting forms.
         */
        function handleInputKeyDown(e) {
            const key = e.key;
            // If chips are currently selected, handle removal or replacement before other keys.
            if (selectedIndices && selectedIndices.size > 0) {
                // On Backspace or Delete, simply remove the selected chips. Prevent default to avoid
                // navigating back in the browser or deleting from the input.
                if (!e.ctrlKey && !e.metaKey && (key === 'Backspace' || key === 'Delete')) {
                    e.preventDefault();
                    removeSelectedChips();
                    return;
                }
                // On other printable characters (e.key has length 1), treat as typing new input:
                // remove the selected chips and start the input with the typed character.
                // Exclude keys that are not regular characters (e.g. Tab, Escape, Arrow keys).
                if (!e.ctrlKey && !e.metaKey && key.length === 1) {
                    e.preventDefault();
                    removeSelectedChips();
                    // Start fresh input with the pressed key
                    setInputValue(key);
                    return;
                }
                // For other keys while selection exists (e.g. Enter), continue to handle normally below.
            }
            // When the input is empty and Backspace is pressed, remove the last chip.
            if (key === 'Backspace' && inputValue.trim() === '' && chips.length > 0) {
                e.preventDefault();
                setChips(prev => prev.slice(0, prev.length - 1));
                return;
            }
            // Support Ctrl/Command + A to copy all chips and current input to the clipboard.
            if ((e.ctrlKey || e.metaKey) && (key === 'a' || key === 'A')) {
                e.preventDefault();
                const aggregated = [...chips, inputValue.trim()]
                    .filter(Boolean)
                    .join(', ');
                // Attempt to use the modern clipboard API; fall back to execCommand if unavailable.
                (async () => {
                    try {
                        await navigator.clipboard.writeText(aggregated);
                        // Optionally, show feedback here if desired.
                    } catch (err) {
                        const temp = document.createElement('textarea');
                        temp.value = aggregated;
                        temp.style.position = 'fixed';
                        temp.style.left = '-9999px';
                        document.body.appendChild(temp);
                        temp.select();
                        try {
                            document.execCommand('copy');
                        } catch (err2) {
                            console.error('Failed to copy all names', err2);
                        }
                        document.body.removeChild(temp);
                    }
                })();
                // Highlight all chips visually to give feedback to the user.
                setSelectedIndices(new Set(chips.map((_, idx) => idx)));
                setDragSelecting(false);
                return;
            }
            if (key === 'Enter' || key === ',') {
                e.preventDefault();
                const trimmed = inputValue.trim();
                if (trimmed) {
                    // When editing a chip (there is text in the input), finalise it.
                    finalizeInput();
                    // Clear any chip selection when finalising input
                    setSelectedIndices(new Set());
                } else if (key === 'Enter') {
                    // If no text is being edited and Enter is pressed, trigger the search.
                    // We use setTimeout to allow any pending state updates to settle.
                    setTimeout(() => {
                        handleSearch();
                        // Clear any chip selection after triggering a search
                        setSelectedIndices(new Set());
                    }, 0);
                }
            }
        }

        /**
         * Update the controlled input state on user input.
         */
        function handleInputChange(e) {
            setInputValue(e.target.value);
        }

        /**
         * When the input loses focus (e.g. clicking outside the input),
         * finalise the current value as a chip. This ensures that any
         * partially typed term is not lost when the user clicks the search
         * button or elsewhere on the page.
         */
        function handleInputBlur() {
            finalizeInput();
        }

        /**
         * Intercept paste events so that multiple comma- or newline-separated
         * entries become individual chips rather than one long string. If
         * there's any unfinished text in the input when the paste occurs, it
         * will be finalised into its own chip before processing the pasted
         * content.
         */
        function handleInputPaste(e) {
            const clipboardData = e.clipboardData || window.clipboardData;
            if (!clipboardData) return;
            const pasted = clipboardData.getData('text');
            if (pasted) {
                // Prevent the default paste to avoid inserting the raw text into the input
                e.preventDefault();
                // Finalise any existing input value
                if (inputValue.trim()) {
                    finalizeInput();
                }
                // Split by commas or newlines into individual chips
                const parts = pasted
                    .split(/[\n,]+/)
                    .map(s => s.trim())
                    .filter(Boolean);
                // Update chips: avoid duplicates and maintain order
                if (parts.length > 0) {
                    setChips(prev => {
                        const existing = new Set(prev);
                        const newChips = [];
                        parts.forEach(p => {
                            if (!existing.has(p)) {
                                existing.add(p);
                                newChips.push(p);
                            }
                        });
                        return [...prev, ...newChips];
                    });
                    // Clear the input after processing the paste
                    setInputValue('');
                }
            }
        }

        /**
         * Handle mouse down on a chip. We record that the mouse is down and
         * where the drag started but do not yet start a selection. Starting
         * a selection happens on mouse enter of another chip.
         */
        function handleChipMouseDown(index, e) {
            if (e.button !== 0) return;
            setMouseDownFlag(true);
            setMouseDownIndex(index);
        }

        /**
         * Handle mouse enter on a chip. If the mouse button is held down and
         * we haven't yet begun a drag selection, start one including the
         * starting chip and the current chip. If a drag selection is already
         * in progress, extend it to include the current chip.
         */
        function handleChipMouseEnter(index) {
            if (!mouseDownFlag) return;
            if (!dragSelecting) {
                // Start a new drag selection and include both the starting and current chip
                setDragSelecting(true);
                setSelectedIndices(new Set([mouseDownIndex, index]));
            } else {
                // Extend existing selection
                setSelectedIndices(prev => {
                    const ns = new Set(prev);
                    ns.add(index);
                    return ns;
                });
            }
        }

        /**
         * Handle mouse up on a chip or the container. Determine whether a
         * selection was made; if not, treat the action as a click on the chip
         * to edit it. Always clear mouseDownFlag. Do not clear selection
         * automatically so that highlighted chips remain visible until a new
         * action.
         */
        function handleChipMouseUp(index) {
            if (!mouseDownFlag) return;
            setMouseDownFlag(false);
            if (dragSelecting) {
                // End drag selection; keep chips highlighted
                setDragSelecting(false);
            } else {
                // No drag; treat this as a click to edit
                handleChipEdit(index);
                // Remove any chip selection after editing
                setSelectedIndices(new Set());
            }
        }

        /**
         * Remove a chip at a given index. The click event is stopped to
         * prevent focusing the container which would immediately blur and
         * finalise the input again.
         */
        function handleChipRemove(index, evt) {
            if (evt) evt.stopPropagation();
            setChips(prev => prev.filter((_, i) => i !== index));
            // Adjust selection indices when a chip is removed
            setSelectedIndices(prev => {
                const ns = new Set();
                prev.forEach(i => {
                    if (i === index) return;
                    ns.add(i > index ? i - 1 : i);
                });
                return ns;
            });
        }

        /**
         * When a chip is clicked (outside the close button), load its value
         * back into the input for editing and remove the chip. After a short
         * delay the input is focused.
         */
        function handleChipEdit(index) {
            const value = chips[index];
            setChips(prev => prev.filter((_, i) => i !== index));
            setInputValue(value);
            // Defer focusing until after state updates
            setTimeout(() => {
                if (inputRef.current) {
                    inputRef.current.focus();
                }
            }, 0);
        }

        /**
         * Automatically prefetch search results for newly added chips. When a
         * chip appears and we don't already have data for it in the
         * prefetchCache, send a background request to the server. Responses
         * populate the cache but do not trigger the results display until
         * handleSearch is called. This prefetching makes the final search
         * substantially faster from the user's perspective.
         */
        useEffect(() => {
            // Determine which chip values have not yet been prefetched. We
            // aggregate them into a single API call to reduce the number of
            // outbound requests and thereby mitigate potential rate limits on
            // the upstream trademark website. Grouping chips together in one
            // request allows the server to process them sequentially while
            // respecting its own caching.
            const namesToFetch = chips.filter(
                chip => !Object.prototype.hasOwnProperty.call(prefetchCache, chip)
            );
            if (namesToFetch.length === 0) return;
            // Mark all names as pending to avoid duplicate prefetch attempts.
            setPrefetchCache(prev => {
                const updated = { ...prev };
                namesToFetch.forEach(name => {
                    updated[name] = null;
                });
                return updated;
            });
            fetch('/api/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ names: namesToFetch.join('\n') })
            })
                .then(res => {
                    if (!res.ok) {
                        throw new Error(`Prefetch failed with status ${res.status}`);
                    }
                    return res.json();
                })
                .then(data => {
                    setPrefetchCache(prev => {
                        const updated = { ...prev };
                        namesToFetch.forEach(name => {
                            updated[name] = data[name];
                        });
                        return updated;
                    });
                })
                .catch(err => {
                    console.error('Prefetch error', err);
                    setPrefetchCache(prev => {
                        const updated = { ...prev };
                        namesToFetch.forEach(name => {
                            updated[name] = { error: err.message };
                        });
                        return updated;
                    });
                });
        }, [chips]);

        /**
         * Render the chip input UI. Chips are shown as small bubbles with a
         * close button. Clicking on a chip loads it back into the input for
         * editing. The input resizes and wraps with the chips. A placeholder
         * is displayed when no chips or input exist.
         */
        function renderTagInput() {
            // Construct chip elements
            const chipElements = chips.map((chip, idx) =>
                React.createElement(
                    'div',
                    {
                        className: `chip${selectedIndices.has(idx) ? ' selected' : ''}`,
                        key: `chip-${idx}`,
                        onMouseDown: (e) => handleChipMouseDown(idx, e),
                        onMouseEnter: () => handleChipMouseEnter(idx),
                        onMouseUp: (e) => {
                            // Prevent the event from bubbling up to the container.
                            e.stopPropagation();
                            handleChipMouseUp(idx);
                        }
                    },
                    [
                        React.createElement(
                            'span',
                            {
                                key: 'text'
                            },
                            chip
                        ),
                        React.createElement(
                            'button',
                            {
                                key: 'close',
                                type: 'button',
                                // Stop propagation on mousedown to prevent initiating a selection when
                                // the remove button is clicked.
                                onMouseDown: (e) => {
                                    e.stopPropagation();
                                },
                                onClick: (e) => handleChipRemove(idx, e)
                            },
                            '\u00d7'
                        )
                    ]
                )
            );
            return React.createElement(
                'div',
                {
                    className: 'tag-input',
                    key: 'taginput',
                    onClick: () => {
                        if (inputRef.current) {
                            inputRef.current.focus();
                        }
                        // Clicking on the input container clears any chip selection
                        setSelectedIndices(new Set());
                    },
                    // End any drag selection when the mouse button is released anywhere on the container.
                    onMouseUp: () => {
                        if (mouseDownFlag) {
                            handleChipMouseUp(mouseDownIndex);
                        }
                    }
                },
                [
                    ...chipElements,
                    React.createElement('input', {
                        key: 'input',
                        ref: inputRef,
                        value: inputValue,
                        onChange: handleInputChange,
                        onKeyDown: handleInputKeyDown,
                        onBlur: handleInputBlur,
                        onPaste: handleInputPaste,
                        placeholder: chips.length === 0 && !inputValue ? 'Enter one or more names separated by commas or new lines (e.g. Golden Emperor, Urban Jungle, Dragon Train)' : '',
                        style: {
                            border: 'none',
                            outline: 'none',
                            flex: '1',
                            minWidth: '120px',
                            fontSize: '1rem',
                            margin: '4px 0',
                            background: 'transparent'
                        }
                    })
                ]
            );
        }

        async function handleCopy() {
            if (!results) return;
            const groups = {
                Green: [],
                Yellow: [],
                Red: []
            };
            Object.entries(results).forEach(([name, info]) => {
                const score = info && info.score;
                if (!score) return;
                if (score === 'Green') {
                    groups.Green.push(name);
                } else if (score === 'Yellow') {
                    groups.Yellow.push(name);
                } else if (score === 'Red') {
                    let company = '';
                    if (info.details && Array.isArray(info.details) && info.details.length > 0) {
                        const det = info.details.find(d => d && (d.ownerName || d.owner));
                        if (det) {
                            const comp = (det.ownerName || det.owner || '')
                                .replace(/\s*[-]+>\s*/g, ' ')
                                .trim();
                            company = comp;
                        }
                    }
                    groups.Red.push(company ? `${name} - ${company}` : name);
                }
            });
            const lines = [];
            lines.push('===Green===');
            groups.Green.forEach(n => lines.push(n));
            lines.push('');
            lines.push('===Yellow===');
            groups.Yellow.forEach(n => lines.push(n));
            lines.push('');
            lines.push('===Red===');
            groups.Red.forEach(n => lines.push(n));
            const text = lines.join('\n');
            try {
                await navigator.clipboard.writeText(text);
                alert('Breakdown copied to clipboard.');
            } catch (err) {
                const temp = document.createElement('textarea');
                temp.value = text;
                temp.style.position = 'fixed';
                temp.style.left = '-9999px';
                document.body.appendChild(temp);
                temp.select();
                try {
                    document.execCommand('copy');
                    alert('Breakdown copied to clipboard.');
                } catch (err2) {
                    console.error('Failed to copy breakdown', err2);
                }
                document.body.removeChild(temp);
            }
        }

        async function handleSearch() {
            // Convert any residual input into a chip before searching
            finalizeInput();
            // Gather the list of unique chips for searching
            const list = chips.map(s => s.trim()).filter(Boolean);
            if (list.length === 0) {
                return;
            }
            setLoading(true);
            setError(null);
            setResults(null);
            try {
                // Determine which names still need to be fetched from the server.
                const namesToFetch = list.filter(n => !prefetchCache[n]);
                let fetchedResults = {};
                if (namesToFetch.length > 0) {
                    const response = await fetch('/api/search', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            names: namesToFetch.join('\n')
                        })
                    });
                    if (!response.ok) {
                        throw new Error(`Server returned status ${response.status}`);
                    }
                    const data = await response.json();
                    fetchedResults = data;
                    // Merge freshly fetched data into prefetchCache
                    setPrefetchCache(prev => {
                        const updated = { ...prev };
                        namesToFetch.forEach(name => {
                            if (data[name]) {
                                updated[name] = data[name];
                            }
                        });
                        return updated;
                    });
                }
                // Construct combined results for all chips using prefetched and newly fetched data.
                const combined = {};
                list.forEach(name => {
                    if (prefetchCache[name]) {
                        combined[name] = prefetchCache[name];
                    } else if (fetchedResults[name]) {
                        combined[name] = fetchedResults[name];
                    }
                });
                setResults(combined);
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        }

        function renderResults() {
            if (!results) return null;
            const entries = Object.entries(results);
            return entries.map(([name, info]) => {
                const lower = info && info.score ? info.score.toLowerCase() : '';
                return React.createElement(
                    'div', {
                    key: name,
                    className: 'card'
                },
                    [
                        React.createElement('h2', {
                            key: 'title',
                            style: {
                                marginTop: 0
                            }
                        }, name),
                        info && info.error ?
                            React.createElement(
                                'p', {
                                key: 'error',
                                style: {
                                    color: '#d32f2f'
                                }
                            },
                                `Error: ${info.error}`
                            ) :
                            [
                                React.createElement(
                                    'div', {
                                    key: 'summary',
                                    style: {
                                        marginBottom: '8px'
                                    }
                                },
                                    [
                                        React.createElement(
                                            'span', {
                                            key: 'badge',
                                            className: `score-label score-${lower}`
                                        },
                                            info.score
                                        ),
                                        React.createElement(
                                            'span', {
                                            key: 'expl',
                                            style: {
                                                verticalAlign: 'middle',
                                                marginLeft: '8px',
                                            },
                                        },
                                            info.explanation
                                        )
                                    ]
                                ),
                                Array.isArray(info.details) && info.details.length > 0 ?
                                    (() => {
                                        // Partition details into priority groups. Any filing containing
                                        // classes 028 or 041 goes into priority1; those containing 009
                                        // (but not in priority1) go into priority2; all others are
                                        // considered lower priority and initially hidden behind the
                                        // "Show More" button. Classes may be strings or arrays.
                                        const priority1 = [];
                                        const priority2 = [];
                                        const others = [];
                                        info.details.forEach(det => {
                                            let classesList = [];
                                            if (Array.isArray(det.classes)) {
                                                classesList = det.classes.map(String);
                                            } else if (det.classes && typeof det.classes === 'string') {
                                                classesList = det.classes.split(/[,\s]+/).filter(Boolean);
                                            }
                                            const has028 = classesList.includes('028');
                                            const has041 = classesList.includes('041');
                                            const has009 = classesList.includes('009');
                                            if (has028 || has041) {
                                                priority1.push(det);
                                            } else if (has009) {
                                                priority2.push(det);
                                            } else {
                                                others.push(det);
                                            }
                                        });
                                        const isExpanded = expandedCards[name] || false;
                                        const displayList = isExpanded ? [...priority1, ...priority2, ...others] : [...priority1, ...priority2];
                                        // Build table rows for the display list
                                        const rows = displayList.map((det, idx) =>
                                            React.createElement(
                                                'tr', {
                                                key: idx,
                                                onClick: () => {
                                                    if (det.detailUrl) {
                                                        window.open(det.detailUrl, '_blank');
                                                    }
                                                },
                                                style: {
                                                    cursor: det.detailUrl ? 'pointer' : 'default'
                                                }
                                            },
                                                det.error ?
                                                    React.createElement(
                                                        'td', {
                                                        colSpan: 6,
                                                        style: {
                                                            color: '#d32f2f'
                                                        }
                                                    },
                                                        det.error
                                                    ) :
                                                    [
                                                        React.createElement(
                                                            'td', {
                                                            key: 'app',
                                                            'data-label': 'Application #'
                                                        },
                                                            det.applicationNumber || ''
                                                        ),
                                                        React.createElement(
                                                            'td', {
                                                            key: 'mark',
                                                            'data-label': 'Word Mark'
                                                        },
                                                            det.wordMark || ''
                                                        ),
                                                        React.createElement(
                                                            'td', {
                                                            key: 'owner',
                                                            'data-label': 'Owner'
                                                        },
                                                            (det.ownerName || det.owner) ?
                                                                (() => {
                                                                    const oname = (det.ownerName || det.owner || '')
                                                                        .replace(/\s*[-]+>\s*/g, ' ')
                                                                        .trim();
                                                                    const oaddr = (det.ownerAddress || '')
                                                                        .replace(/\s*[-]+>\s*/g, ' ')
                                                                        .trim();
                                                                    const elements = [];
                                                                    if (oname) {
                                                                        elements.push(
                                                                            React.createElement(
                                                                                'div', {
                                                                                key: 'name',
                                                                                style: {
                                                                                    fontWeight: 600
                                                                                }
                                                                            },
                                                                                oname
                                                                            )
                                                                        );
                                                                    }
                                                                    if (oaddr) {
                                                                        elements.push(
                                                                            React.createElement(
                                                                                'div', {
                                                                                key: 'addr',
                                                                                style: {
                                                                                    fontSize: '0.8rem',
                                                                                    color: '#555'
                                                                                }
                                                                            },
                                                                                oaddr
                                                                            )
                                                                        );
                                                                    }
                                                                    return elements;
                                                                })() :
                                                                ''
                                                        ),
                                                        React.createElement(
                                                            'td', {
                                                            key: 'date',
                                                            'data-label': 'Filing Date'
                                                        },
                                                            det.filingDate || ''
                                                        ),
                                                        React.createElement(
                                                            'td', {
                                                            key: 'status',
                                                            'data-label': 'Status'
                                                        },
                                                            det.status || ''
                                                        ),
                                                        React.createElement(
                                                            'td', {
                                                            key: 'classes',
                                                            'data-label': 'Classes'
                                                        },
                                                            Array.isArray(det.classes) ?
                                                                det.classes.join(', ') :
                                                                ''
                                                        )
                                                    ]
                                            )
                                        );
                                        const table = React.createElement(
                                            'div', {
                                            key: 'tablewrap',
                                            className: 'table-container'
                                        },
                                            React.createElement(
                                                'table', {
                                                className: 'detail-table'
                                            },
                                                [
                                                    React.createElement(
                                                        'thead', {
                                                        key: 'thead'
                                                    },
                                                        React.createElement(
                                                            'tr',
                                                            null,
                                                            [
                                                                'Application #',
                                                                'Word Mark',
                                                                'Owner',
                                                                'Filing Date',
                                                                'Status',
                                                                'Classes'
                                                            ].map((h, idx) =>
                                                                React.createElement(
                                                                    'th', {
                                                                    key: `h${idx}`
                                                                },
                                                                    h
                                                                )
                                                            )
                                                        )
                                                    ),
                                                    React.createElement(
                                                        'tbody', {
                                                        key: 'tbody'
                                                    },
                                                        rows
                                                    )
                                                ]
                                            )
                                        );
                                        // Only render the Show More/Less button if there are hidden entries.
                                        const showButton = others.length > 0 ?
                                            React.createElement(
                                                'button', {
                                                key: 'showMoreBtn',
                                                type: 'button',
                                                className: 'show-more-button',
                                                onClick: () => toggleExpand(name),
                                                style: {
                                                    marginTop: '8px'
                                                }
                                            },
                                                isExpanded ? 'Show Less' : 'Show More'
                                            ) :
                                            null;
                                        return [table, showButton];
                                    })() :
                                    React.createElement(
                                        'p', {
                                        key: 'nodetails',
                                        style: {
                                            fontStyle: 'italic'
                                        }
                                    },
                                        'No trademark filings found.'
                                    )
                            ]
                    ]
                );
            });
        }

        return React.createElement(
            'div', {
            className: 'container'
        },
            React.createElement(
                'div', {
                className: 'glass'
            },
                [
                    React.createElement('h1', {
                        key: 'header'
                    }, 'Australia Trademark Slot Name Availability Checker'),
                    React.createElement('p', {
                        key: 'byline',
                        className: 'byline'
                    }, 'by Robert McKone'),
                    /* Chip input replaces the traditional textarea. */
                    renderTagInput(),

                    React.createElement(
                        'div', {
                        key: 'buttons',
                        style: {
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '8px',
                            alignItems: 'center'
                        }
                    },
                        [
                            React.createElement(
                                'button', {
                                key: 'searchButton',
                                onClick: handleSearch,
                                disabled: loading
                            },
                                loading ? 'Searching…' : 'Search'
                            ),
                            results ?
                                React.createElement(
                                    'button', {
                                    key: 'copyButton',
                                    onClick: handleCopy,
                                    style: {}
                                },
                                    'Copy'
                                ) :
                                null
                        ]
                    ),
                    loading ?
                        React.createElement('div', {
                            key: 'spinner',
                            className: 'spinner'
                        }) :
                        null,
                    error ?
                        React.createElement(
                            'p', {
                            key: 'error',
                            style: {
                                color: '#d32f2f'
                            }
                        },
                            error
                        ) :
                        null,
                    results ?
                        React.createElement(
                            'div', {
                            key: 'results',
                            className: 'results'
                        },
                            renderResults()
                        ) :
                        null
                ]
            )
        );
    }

    const rootEl = document.getElementById('root');
    ReactDOM.createRoot(rootEl).render(React.createElement(App));
})();
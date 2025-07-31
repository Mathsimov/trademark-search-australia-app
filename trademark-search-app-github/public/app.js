(() => {
    const {
        useState
    } = React;

    function App() {
        const [namesInput, setNamesInput] = useState('');
        const [results, setResults] = useState(null);
        const [loading, setLoading] = useState(false);
        const [error, setError] = useState(null);

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
            const trimmed = namesInput.trim();
            if (!trimmed) {
                return;
            }
            setLoading(true);
            setError(null);
            setResults(null);
            try {
                const response = await fetch('/api/search', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        names: trimmed
                    })
                });
                if (!response.ok) {
                    throw new Error(`Server returned status ${response.status}`);
                }
                const data = await response.json();
                setResults(data);
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
                                    React.createElement(
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
                                                    info.details.map((det, idx) =>
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
                                                    )
                                                )
                                            ]
                                        )
                                    ) :
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
                    React.createElement('textarea', {
                        key: 'textarea',
                        placeholder: 'Enter one or more names separated by commas or new lines (e.g. Golden Emperor, Urban Jungle, Dragon Train)',
                        value: namesInput,
                        onChange: e => setNamesInput(e.target.value)
                    }),

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
import { useHttp, usePage } from '@inertiajs/react';
import { Bug, Lightbulb, X } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { store } from '@/actions/App/Http/Controllers/IssueController';
import { index as similarIssues } from '@/actions/App/Http/Controllers/SimilarIssueController';
import { showTimeout, timeoutFrom } from '@/components/timeout-dialog';
import { WordmarkText } from '@/components/wordmark-text';
import { collectEnvironment } from '@/lib/environment';
import type { IssueEnvironment } from '@/lib/environment';
import type { IssueCommand, IssueKind } from '@/lib/issue-commands';
import {
    hintedCommand,
    issueCommands,
    issueTitle,
    suggestedCommands,
    typedCommand,
} from '@/lib/issue-commands';
import { hasModKey } from '@/lib/keyboard';
import { cn } from '@/lib/utils';

const hintDismissedKey = 'issue-command-hint-dismissed';

function isHintDismissed(): boolean {
    try {
        return window.localStorage.getItem(hintDismissedKey) === '1';
    } catch {
        return false;
    }
}

/**
 * Typing `/bug` or `/feature` and a space turns the commit draft into an issue draft, opened upstream by the app.
 */
export function useIssueCommand({
    body,
    updateBody,
    enabled,
    initialKind = null,
    onCreated,
}: {
    body: string;
    updateBody: (body: string) => void;
    enabled: boolean;
    initialKind?: IssueKind | null;
    onCreated: () => void;
}) {
    const [kind, setKind] = useState<IssueKind | null>(
        enabled ? initialKind : null,
    );
    const [selected, setSelected] = useState(0);
    const [dismissed, setDismissed] = useState(false);
    const [focused, setFocused] = useState(false);
    const [hintDismissed, setHintDismissed] = useState(isHintDismissed);
    const request = useHttp<
        { command: string; body: string; environment?: IssueEnvironment },
        { number: number; url: string }
    >({ command: '', body: '' });
    const command =
        issueCommands.find((candidate) => candidate.kind === kind) ?? null;
    // A draft restored from the stash can be a lone slash: the menu only opens while the user is typing in it.
    const suggestions =
        enabled && kind === null && !dismissed && focused
            ? suggestedCommands(body)
            : [];
    const hint =
        enabled && kind === null && !hintDismissed ? hintedCommand(body) : null;

    const start = (next: IssueKind, rest: string) => {
        setKind(next);
        setSelected(0);
        updateBody(rest);
    };

    const change = (value: string) => {
        setDismissed(false);
        const typed = enabled && kind === null ? typedCommand(value) : null;

        if (typed) {
            start(typed.kind, typed.body);
        } else {
            updateBody(value);
        }
    };

    const submit = async () => {
        if (command === null || request.processing) {
            return;
        }

        request.transform(() => ({
            command: command.name,
            body,
            environment: collectEnvironment(),
        }));

        try {
            const issue = await request.submit(store(), {
                onError: (errors) => {
                    toast.error(
                        Object.values(errors)[0] ?? 'Check your draft.',
                    );
                },
                onHttpException: (response) => {
                    const timeout = timeoutFrom(response.status, response.data);

                    if (timeout) {
                        showTimeout(timeout);
                    } else {
                        toast.error(
                            response.status === 429
                                ? 'Issue limit reached: 10 a day. Try again tomorrow.'
                                : 'GitHub did not confirm the issue. Check upstream before retrying. Your draft is safe.',
                        );
                    }
                },
                onNetworkError: () => {
                    toast.error(
                        'Connection lost. Check upstream before retrying. Your draft is safe.',
                    );
                },
            });
            setKind(null);
            onCreated();
            toast.success(`Opened issue #${issue.number}.`, {
                duration: 10000,
                action: {
                    label: 'View issue',
                    onClick: () =>
                        window.open(issue.url, '_blank', 'noopener,noreferrer'),
                },
            });
        } catch {
            // The callbacks explain the failure; the draft stays an issue for a retry.
        }
    };

    /**
     * Handles the keys the issue command owns, returning whether it did.
     */
    const handleKeyDown = (
        event: KeyboardEvent<HTMLTextAreaElement>,
        submittable: boolean,
    ): boolean => {
        if (event.nativeEvent.isComposing) {
            return false;
        }

        if (suggestions.length > 0) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setSelected(
                    (index) =>
                        (index +
                            (event.key === 'ArrowDown' ? 1 : -1) +
                            suggestions.length) %
                        suggestions.length,
                );
                return true;
            }

            if (
                (event.key === 'Tab' || event.key === 'Enter') &&
                !event.shiftKey &&
                !hasModKey(event)
            ) {
                event.preventDefault();
                start(suggestions[selected % suggestions.length].kind, '');
                return true;
            }

            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setDismissed(true);
                return true;
            }
        }

        if (command === null) {
            return false;
        }

        if (
            event.key === 'Backspace' &&
            event.currentTarget.selectionStart === 0 &&
            event.currentTarget.selectionEnd === 0
        ) {
            event.preventDefault();
            setKind(null);
            return true;
        }

        if (event.key === 'Enter' && hasModKey(event)) {
            event.preventDefault();
            if (submittable) void submit();
            return true;
        }

        return false;
    };

    return {
        command,
        suggestions,
        hint,
        dismissHint: () => {
            setHintDismissed(true);
            try {
                window.localStorage.setItem(hintDismissedKey, '1');
            } catch {
                // Without storage, the hint stays dismissed until the page reloads.
            }
        },
        selected: selected % Math.max(suggestions.length, 1),
        processing: request.processing,
        change,
        focus: () => setFocused(true),
        blur: () => setFocused(false),
        start,
        exit: () => setKind(null),
        submit,
        handleKeyDown,
    };
}

export type UseIssueCommandReturn = ReturnType<typeof useIssueCommand>;

const icons = { feature: Lightbulb, bug: Bug };

export function IssueCommandBadge({
    command,
    onExit,
}: {
    command: IssueCommand;
    onExit: () => void;
}) {
    const { repository } = usePage().props;
    const Icon = icons[command.kind];

    return (
        <div className="mt-1 flex min-w-0 items-center gap-2 text-[13px]">
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary-soft py-0.5 pr-1 pl-2 font-mono text-primary">
                <Icon className="size-3.5" aria-hidden="true" />
                {command.name}
                <button
                    type="button"
                    onClick={onExit}
                    aria-label={`Cancel ${command.name}, back to a commit`}
                    className="rounded-sm p-0.5 hover:bg-primary/15"
                >
                    <X className="size-3.5" aria-hidden="true" />
                </button>
            </span>
            <span className="min-w-0 truncate text-muted-foreground">
                Public issue on {repository}, crediting you, with your browser
                and screen details
            </span>
        </div>
    );
}

export function IssueCommandSuggestions({
    suggestions,
    selected,
    onPick,
}: {
    suggestions: IssueCommand[];
    selected: number;
    onPick: (kind: IssueKind) => void;
}) {
    return (
        <div
            data-command-suggestions
            role="listbox"
            aria-label="Commands"
            className="mt-1 w-full max-w-sm rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
            {suggestions.map((command, index) => {
                const Icon = icons[command.kind];

                return (
                    <button
                        key={command.kind}
                        type="button"
                        role="option"
                        aria-selected={selected === index}
                        tabIndex={-1}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => onPick(command.kind)}
                        className={cn(
                            'flex w-full items-center gap-3 rounded-sm px-2 py-1.5 text-left text-sm',
                            selected === index && 'bg-accent',
                        )}
                    >
                        <Icon
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                        />
                        <span className="w-20 shrink-0 font-mono">
                            {command.name}
                        </span>
                        <span className="min-w-0 truncate text-muted-foreground">
                            {command.description}
                        </span>
                    </button>
                );
            })}
            <p className="px-2 pt-1 pb-0.5 font-mono text-xs text-muted-foreground">
                ↑↓ select · Tab or Enter pick · Esc dismiss
            </p>
        </div>
    );
}

export function IssueCommandHint({
    command,
    onUse,
    onDismiss,
}: {
    command: IssueCommand;
    onUse: (kind: IssueKind) => void;
    onDismiss: () => void;
}) {
    const Icon = icons[command.kind];

    return (
        <div className="mt-1 flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">
                <WordmarkText>
                    {command.kind === 'bug'
                        ? 'Found a bug in /dev/null?'
                        : 'Have an idea for /dev/null?'}
                </WordmarkText>
            </span>
            <button
                type="button"
                onClick={() => onUse(command.kind)}
                className="shrink-0 rounded-sm font-mono text-primary hover:underline"
            >
                Use {command.name}
            </button>
            <button
                type="button"
                onClick={onDismiss}
                aria-label="Don't suggest issue commands again"
                className="shrink-0 rounded-sm p-0.5 hover:bg-accent"
            >
                <X className="size-3.5" aria-hidden="true" />
            </button>
        </div>
    );
}

type SimilarIssue = { number: number; title: string; url: string };

/**
 * The open issues whose titles share words with the draft's, shown while it is written, so its author can join an
 * existing issue instead of opening a duplicate. The last matches stay until the next ones arrive, and the slot keeps
 * the height of three, so matches arriving after a pause never move the page.
 */
export function SimilarIssues({ body }: { body: string }) {
    const title = issueTitle(body);
    const [issues, setIssues] = useState<SimilarIssue[]>([]);
    const matches = title.length < 3 ? [] : issues;

    useEffect(() => {
        if (title.length < 3) {
            return;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => {
            void fetch(similarIssues.url({ query: { q: title } }), {
                headers: { Accept: 'application/json' },
                signal: controller.signal,
            })
                .then(async (response) => {
                    const data = response.ok
                        ? ((await response.json()) as {
                              issues: SimilarIssue[];
                          })
                        : { issues: [] };

                    if (!controller.signal.aborted) {
                        setIssues(data.issues);
                    }
                })
                .catch(() => undefined);
        }, 500);

        return () => {
            clearTimeout(timeout);
            controller.abort();
        };
    }, [title]);

    return (
        <section
            aria-label="Similar open issues"
            aria-live="polite"
            data-test="similar-issues"
            className="mt-1 h-23 min-w-0 overflow-hidden text-[13px]"
        >
            <p className="h-5 truncate text-muted-foreground">
                {matches.length > 0
                    ? 'Already asked? Similar open issues:'
                    : 'Similar open issues show here as you write the title.'}
            </p>
            <ul>
                {matches.map((issue) => (
                    <li key={issue.number} className="flex h-6 min-w-0">
                        <a
                            href={issue.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={issue.title}
                            className="flex min-w-0 items-center gap-1.5 rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                        >
                            <span className="shrink-0 font-mono text-primary tabular-nums">
                                #{issue.number}
                            </span>
                            <span className="min-w-0 truncate">
                                {issue.title}
                            </span>
                            <span className="sr-only">
                                (opens in a new tab)
                            </span>
                        </a>
                    </li>
                ))}
            </ul>
        </section>
    );
}

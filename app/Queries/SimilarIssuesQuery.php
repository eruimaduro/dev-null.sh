<?php

declare(strict_types=1);

namespace App\Queries;

use App\Contracts\Services\GitHubProvider;
use Illuminate\Http\Client\HttpClientException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Fluent;
use Illuminate\Support\Str;

/**
 * @phpstan-import-type Issue from GitHubProvider
 */
final readonly class SimilarIssuesQuery
{
    private const array COMMON_WORDS = ['the', 'and', 'for', 'add', 'with', 'not', 'are', 'can', 'from', 'that', 'this', 'when', 'should', 'would', 'have', 'please', 'feature', 'bug', 'issue', 'make', 'page', 'commit', 'commits', 'dev', 'null', 'devnull'];

    public function __construct(private GitHubProvider $github)
    {
        //
    }

    /**
     * The open issues whose titles share words with the title of an issue draft, best match first, so its author sees
     * a duplicate before opening it. GitHub takes up to five operators in a query, so only the first five words count.
     * A search GitHub could not run finds nothing, as an empty one does, and is not remembered, so the next one asks again.
     *
     * @return list<Issue>
     */
    public function get(string $title): array
    {
        $words = Str::of($title)->lower()->matchAll('/[\p{L}\p{N}]{3,}/u')->diff(self::COMMON_WORDS)->unique()->take(5);

        if ($words->isEmpty()) {
            return [];
        }

        $query = 'repo:'.config()->string('services.github.repository').' is:issue is:open in:title '.$words->implode(' OR ');

        try {
            /** @var list<Issue> */
            return Cache::remember('similar-issues:'.hash('xxh128', $query), 300, fn (): array => collect($this->github->searchIssues($query, 3, null)['items'])
                ->mapInto(Fluent::class)
                ->map(fn (Fluent $issue): array => [
                    'number' => $issue->integer('number'),
                    'title' => $issue->string('title')->value(),
                    'url' => $issue->string('html_url')->value(),
                ])
                ->all());
        } catch (HttpClientException) {
            return [];
        }
    }
}

<?php

declare(strict_types=1);

use App\Contracts\Services\GitHubProvider;
use App\Models\User;
use GuzzleHttp\Psr7\Response as Psr7Response;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\RequestException;
use Illuminate\Http\Client\Response;

function similarIssueResults(): array
{
    return ['incomplete' => false, 'total' => 2, 'items' => [
        ['number' => 1539, 'title' => '[Feature] Add dark theme to android', 'html_url' => 'https://github.com/dev-null-sh/dev-null.sh/issues/1539', 'state' => 'open'],
        ['number' => 1581, 'title' => 'Explore mode', 'html_url' => 'https://github.com/dev-null-sh/dev-null.sh/issues/1581', 'state' => 'open'],
    ]];
}

it('finds the open issues whose titles share words with the draft, best match first', function (): void {
    $this->mock(GitHubProvider::class)->shouldReceive('searchIssues')
        ->with('repo:dev-null-sh/dev-null.sh is:issue is:open in:title dark OR mode OR android', 3, null)
        ->once()
        ->andReturn(similarIssueResults());

    $this->actingAs(User::factory()->create())
        ->getJson(route('similar-issue.index', ['q' => 'Dark mode on Android']))
        ->assertOk()
        ->assertExactJson(['issues' => [
            ['number' => 1539, 'title' => '[Feature] Add dark theme to android', 'url' => 'https://github.com/dev-null-sh/dev-null.sh/issues/1539'],
            ['number' => 1581, 'title' => 'Explore mode', 'url' => 'https://github.com/dev-null-sh/dev-null.sh/issues/1581'],
        ]]);
});

it('searches the configured repository', function (): void {
    config(['services.github.repository' => 'example/upstream']);

    $this->mock(GitHubProvider::class)->shouldReceive('searchIssues')
        ->with('repo:example/upstream is:issue is:open in:title dark OR mode', 3, null)
        ->once()
        ->andReturn(['incomplete' => false, 'total' => 0, 'items' => []]);

    $this->actingAs(User::factory()->create())
        ->getJson(route('similar-issue.index', ['q' => 'Dark mode']))
        ->assertExactJson(['issues' => []]);
});

it('searches by the first five words that are not short or common, once each', function (): void {
    $this->mock(GitHubProvider::class)->shouldReceive('searchIssues')
        ->with('repo:dev-null-sh/dev-null.sh is:issue is:open in:title heic OR photos OR upload OR iphone OR mac', 3, null)
        ->once()
        ->andReturn(['incomplete' => false, 'total' => 0, 'items' => []]);

    $this->actingAs(User::factory()->create())
        ->getJson(route('similar-issue.index', ['q' => 'Feature: please add HEIC photos upload from the iPhone and the Mac, photos too, and videos']))
        ->assertOk();
});

it('asks GitHub nothing for a title without a word to search', function (string $title): void {
    $this->mock(GitHubProvider::class)->shouldNotReceive('searchIssues');

    $this->actingAs(User::factory()->create())
        ->getJson(route('similar-issue.index', ['q' => $title]))
        ->assertOk()
        ->assertExactJson(['issues' => []]);
})->with(['Bug', 'Add a UI', '!!!', 'the and for']);

it('asks GitHub once for the same search until it expires', function (): void {
    $github = $this->mock(GitHubProvider::class);
    $github->shouldReceive('searchIssues')->andReturn(similarIssueResults(), ['incomplete' => false, 'total' => 0, 'items' => []]);

    $this->actingAs(User::factory()->create());

    foreach (range(1, 2) as $attempt) {
        $this->getJson(route('similar-issue.index', ['q' => 'Dark mode on Android']))->assertJsonCount(2, 'issues');
    }

    $github->shouldHaveReceived('searchIssues')->once();

    $this->travel(6)->minutes();

    $this->getJson(route('similar-issue.index', ['q' => 'Dark mode on Android']))->assertExactJson(['issues' => []]);
});

it('finds nothing when GitHub cannot search', function (Throwable $exception): void {
    $this->mock(GitHubProvider::class)->shouldReceive('searchIssues')->andThrow($exception);

    $this->actingAs(User::factory()->create())
        ->getJson(route('similar-issue.index', ['q' => 'Dark mode']))
        ->assertOk()
        ->assertExactJson(['issues' => []]);
})->with([
    'forbidden' => fn (): RequestException => new RequestException(new Response(new Psr7Response(403))),
    'rate limited' => fn (): RequestException => new RequestException(new Response(new Psr7Response(429))),
    'server error' => fn (): RequestException => new RequestException(new Response(new Psr7Response(500))),
    'unreachable' => fn (): ConnectionException => new ConnectionException('timed out'),
]);

it('requires authentication to find similar issues', function (): void {
    $this->mock(GitHubProvider::class)->shouldNotReceive('searchIssues');

    $this->getJson(route('similar-issue.index', ['q' => 'Dark mode']))->assertUnauthorized();
});

it('rejects a missing, too long or malformed title before contacting GitHub', function (mixed $title): void {
    $this->mock(GitHubProvider::class)->shouldNotReceive('searchIssues');

    $this->actingAs(User::factory()->create())
        ->getJson(route('similar-issue.index', ['q' => $title]))
        ->assertUnprocessable()
        ->assertJsonValidationErrors('q');
})->with([null, '', str_repeat('a', 257), [['Dark mode']]]);

it('limits how many searches each person may run in a minute', function (): void {
    $this->mock(GitHubProvider::class)->shouldReceive('searchIssues')->andReturn(['incomplete' => false, 'total' => 0, 'items' => []]);

    $this->actingAs(User::factory()->create());

    foreach (range(1, 10) as $attempt) {
        $this->getJson(route('similar-issue.index', ['q' => "Dark mode {$attempt}"]))->assertOk();
    }

    $this->getJson(route('similar-issue.index', ['q' => 'Dark mode']))->assertTooManyRequests();

    $this->actingAs(User::factory()->create())
        ->getJson(route('similar-issue.index', ['q' => 'Dark mode']))
        ->assertOk();
});

it('limits how many searches everyone together may run in a minute', function (): void {
    $this->mock(GitHubProvider::class)->shouldReceive('searchIssues')->andReturn(['incomplete' => false, 'total' => 0, 'items' => []]);

    foreach (range(1, 2) as $person) {
        $this->actingAs(User::factory()->create());

        foreach (range(1, 10) as $attempt) {
            $this->getJson(route('similar-issue.index', ['q' => "Dark mode {$person} {$attempt}"]))->assertOk();
        }
    }

    $this->actingAs(User::factory()->create())
        ->getJson(route('similar-issue.index', ['q' => 'Dark mode']))
        ->assertTooManyRequests();

    $this->travel(1)->minute();

    $this->getJson(route('similar-issue.index', ['q' => 'Dark mode']))->assertOk();
});

it('limits how many searches each person may run in a day', function (): void {
    $this->mock(GitHubProvider::class)->shouldReceive('searchIssues')->andReturn(['incomplete' => false, 'total' => 0, 'items' => []]);

    $this->actingAs(User::factory()->create());

    foreach (range(1, 100) as $attempt) {
        if ($attempt % 10 === 0) {
            $this->travel(1)->minute();
        }

        $this->getJson(route('similar-issue.index', ['q' => "Dark mode {$attempt}"]))->assertOk();
    }

    $this->travel(1)->minute();

    $this->getJson(route('similar-issue.index', ['q' => 'Dark mode']))->assertTooManyRequests();
});

it('asks GitHub again after a search it could not run', function (): void {
    $github = $this->mock(GitHubProvider::class);
    $github->shouldReceive('searchIssues')->andThrow(new ConnectionException('timed out'))->once()->ordered();
    $github->shouldReceive('searchIssues')->andReturn(similarIssueResults())->once()->ordered();

    $this->actingAs(User::factory()->create());

    $this->getJson(route('similar-issue.index', ['q' => 'Dark mode on Android']))->assertExactJson(['issues' => []]);
    $this->getJson(route('similar-issue.index', ['q' => 'Dark mode on Android']))->assertJsonCount(2, 'issues');
});

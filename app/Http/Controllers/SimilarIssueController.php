<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Requests\ListSimilarIssuesRequest;
use App\Queries\SimilarIssuesQuery;
use Illuminate\Http\JsonResponse;

final readonly class SimilarIssueController
{
    public function index(ListSimilarIssuesRequest $request, SimilarIssuesQuery $issues): JsonResponse
    {
        return response()->json(['issues' => $issues->get($request->string('q')->value())]);
    }
}

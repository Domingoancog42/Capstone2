<?php
declare(strict_types=1);

const COMPENSATORY_APPROVAL_ROUTE_STANDARD = 'standard';
const COMPENSATORY_APPROVAL_ROUTE_CHIEF_ADMIN = 'chief_admin_regional_director';

/** Keep unknown or legacy values on the route used by divisions that require a Division Chief. */
function normalize_compensatory_approval_route(mixed $route): string
{
    return strtolower(trim((string)($route ?? ''))) === COMPENSATORY_APPROVAL_ROUTE_CHIEF_ADMIN
        ? COMPENSATORY_APPROVAL_ROUTE_CHIEF_ADMIN
        : COMPENSATORY_APPROVAL_ROUTE_STANDARD;
}

function compensatory_uses_chief_admin_route(mixed $route): bool
{
    return normalize_compensatory_approval_route($route) === COMPENSATORY_APPROVAL_ROUTE_CHIEF_ADMIN;
}

/** FAD/FAM joins the already-direct ORD route; all other divisions require their Division Chief. */
function compensatory_approval_route_for_division(mixed $code, mixed $name): string
{
    $divisionCode = strtoupper(trim((string)($code ?? '')));
    $divisionName = preg_replace('/[^a-z]/', '', strtolower((string)($name ?? '')));
    $directCodes = ['ORD', 'FAD', 'FAM'];
    $directNames = [
        'officeoftheregionaldirector',
        'financeadministrativemanagement',
        'financeandadministrativemanagement',
        'financeandadministrativedivision',
    ];

    return in_array($divisionCode, $directCodes, true) || in_array($divisionName, $directNames, true)
        ? COMPENSATORY_APPROVAL_ROUTE_CHIEF_ADMIN
        : COMPENSATORY_APPROVAL_ROUTE_STANDARD;
}

/**
 * Direct-route offices (FAD and the separately configured ORD) go to Chief Admin and then the
 * Regional Director. Every other division goes to its Division Chief, then Chief Admin, then the
 * Regional Director. HR Head and HR Staff are not CTO approval desks.
 */
function compensatory_workflow_stage(string $status, mixed $route): ?array
{
    if (compensatory_uses_chief_admin_route($route)) {
        return match ($status) {
            'Pending', 'Endorsed' => ['roles' => ['chiefadmin'], 'next' => 'Reviewed'],
            'Reviewed' => ['roles' => ['regionaldirector'], 'next' => 'Approved'],
            default => null,
        };
    }

    return match ($status) {
        'Pending' => ['roles' => ['chief'], 'next' => 'Endorsed'],
        'Endorsed' => ['roles' => ['chiefadmin'], 'next' => 'Reviewed'],
        'Reviewed' => ['roles' => ['regionaldirector'], 'next' => 'Approved'],
        default => null,
    };
}

function compensatory_workflow_stage_roles(string $status, mixed $route): array
{
    return compensatory_workflow_stage($status, $route)['roles'] ?? [];
}

function compensatory_workflow_next_status(string $status, mixed $route): ?string
{
    return compensatory_workflow_stage($status, $route)['next'] ?? null;
}

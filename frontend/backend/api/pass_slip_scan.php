<?php
declare(strict_types=1);

/*
 * Public gate scanner endpoint.
 *
 * The unguessable 128-bit token inside a filed pass slip's QR code is the credential. This endpoint
 * accepts no operation except advancing that credential from ACTIVE to OUT or OUT to COMPLETED.
 * It deliberately bypasses session authentication and CSRF because it does not act with a user's
 * ambient browser authority; the token has to be physically presented to the scanner.
 *
 * It also answers one read, GET ?action=scan_history: the station's recent scans, so every device
 * at the desk shows the same list. Each entry carries only what a scan response already shows --
 * name, reference, status, times -- never an employee number, division, destination or token.
 */
define('HRIS_CSRF_EXEMPT', true);
define('HRIS_PUBLIC_PASS_SLIP_SCAN', true);

require __DIR__ . '/pass_slip.php';

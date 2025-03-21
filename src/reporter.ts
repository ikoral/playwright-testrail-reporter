import TestRail, { AddResultsForCases } from "@dlenroc/testrail"
import {
    Reporter,
    TestCase,
    TestError,
    TestResult,
} from "@playwright/test/reporter"
import logger from "./logger"
import dotenv from "dotenv"

// Read from default ".env" file.
dotenv.config()

/**
 * Mapping status within Playwright & TestRail
 */
const StatusMap = new Map<string, number>([
    ["failed", 5],
    ["passed", 1],
    ["skipped", 3],
    ["timedout", 5],
    ["interrupted", 5],
])

/**
 * Initialise TestRail API credential auth
 */
const api = new TestRail({
    host: process.env.TESTRAIL_HOST as string,
    password: process.env.TESTRAIL_PASSWORD as string,
    username: process.env.TESTRAIL_USERNAME as string,
})

const testResults: AddResultsForCases[] = []
// Track test case IDs that need to be added to the run
const testCasesToAdd: number[] = []
// Track test case IDs already in the run
const existingTestCaseIds: Set<number> = new Set()

export class TestRailReporter implements Reporter {
    async onBegin?() {
        if (!process.env.TESTRAIL_RUN_ID) {
            logger("No 'TESTRAIL_RUN_ID' found, skipping reporting......")
            return
        }

        logger(
            "Existing Test Run with ID " +
                process.env.TESTRAIL_RUN_ID +
                " will be used",
        )

        // Fetch existing test cases in the run
        const runId = parseInt(process.env.TESTRAIL_RUN_ID as string)
        try {
            const tests = await api.getTests(runId)
            tests.forEach((test) => {
                existingTestCaseIds.add(test.case_id)
            })
            logger(
                `Found ${existingTestCaseIds.size} test cases in run ${runId}`,
            )
        } catch (error) {
            logger(`Error fetching tests for run ${runId}: ${error}`)
        }
    }

    onTestEnd(test: TestCase, result: TestResult) {
        if (!process.env.TESTRAIL_RUN_ID) {
            return
        }

        logger(`Test Case Completed : ${test.title} Status : ${result.status}`)

        // Return no test case match with TestRail Case ID Regex
        const testCaseMatches = getTestCaseName(test.title)
        if (testCaseMatches != null) {
            try {
                testCaseMatches.forEach((testCaseMatch) => {
                    const testId = parseInt(testCaseMatch.substring(1), 10)

                    // Check if test case is in the run
                    if (!existingTestCaseIds.has(testId)) {
                        testCasesToAdd.push(testId)
                        existingTestCaseIds.add(testId) // Add to set to avoid duplicates
                        logger(`Test case C${testId} not in run, will be added`)
                    }

                    // Update test status if test case is not skipped
                    if (result.status != "skipped") {
                        const testComment = setTestComment(result)
                        const payload = {
                            case_id: testId,
                            status_id: StatusMap.get(result.status),
                            comment: testComment,
                        }
                        testResults.push(payload)
                    }
                })
            } catch (error) {
                console.log(error)
            }
        } else {
            logger("Test case could not be extracted from test title!")
        }
    }

    async onEnd(): Promise<void> {
        if (!process.env.TESTRAIL_RUN_ID) {
            return
        }

        const runId = parseInt(process.env.TESTRAIL_RUN_ID as string)

        // Add missing test cases to the run if any
        if (testCasesToAdd.length > 0) {
            try {
                logger(
                    `Adding ${testCasesToAdd.length} test cases to run ${runId}`,
                )

                // First get the current run to see its configuration
                const currentRun = await api.getRun(runId)

                // Prepare the update payload
                const updatePayload: any = {
                    case_ids: testCasesToAdd,
                    include_all: currentRun.include_all,
                }

                // If the run doesn't include all test cases, we need to add our new cases
                // to the existing ones to avoid replacing them
                if (!currentRun.include_all) {
                    // Get existing case IDs if they're not already included in all cases
                    const existingCaseIds = Array.from(
                        existingTestCaseIds,
                    ).filter((id) => !testCasesToAdd.includes(id))

                    // Combine existing and new case IDs
                    updatePayload.case_ids = [
                        ...existingCaseIds,
                        ...testCasesToAdd,
                    ]
                    logger(
                        `Preserving ${existingCaseIds.length} existing test cases in the run`,
                    )
                }

                // Update the run with the combined test cases
                await api.updateRun(runId, updatePayload)
                logger(`Successfully added test cases to run ${runId}`)
            } catch (error) {
                logger(`Error adding test cases to run ${runId}: ${error}`)
                // If we can't add test cases, we should still try to update results for existing ones
            }
        }

        // Update test results
        if (testResults.length > 0) {
            logger(
                "Updating test status for the following TestRail Run ID: " +
                    runId,
            )
            await updateResultCases(runId, testResults)
        } else {
            logger("No test results to update")
        }
    }

    onError(error: TestError): void {
        logger(error.message)
    }
}

/**
 * Get list of matching Test IDs
 */
export function getTestCaseName(testname: string) {
    const testCaseIdRegex = /\bC(\d+)\b/g
    const testCaseMatches = [testname.match(testCaseIdRegex)]

    if (testCaseMatches[0] != null) {
        testCaseMatches[0].forEach((testCaseMatch) => {
            const testCaseId = parseInt(testCaseMatch.substring(1), 10)
            logger("Matched Test Case ID: " + testCaseId)
        })
    } else {
        logger("No test case matches available")
    }
    return testCaseMatches[0]
}

/**
 * Set Test comment for TestCase Failed | Passed
 * @param result
 * @returns
 */
function setTestComment(result: TestResult) {
    if (
        result.status == "failed" ||
        result.status == "timedOut" ||
        result.status == "interrupted"
    ) {
        const comment = { testStatus: result.status, testError: result.error }
        return JSON.stringify(comment)
    } else {
        return `Test Passed within ${result.duration} ms`
    }
}

/**
 * Update TestResult for Multiple Cases
 * @param runId
 * @param payload
 */
async function updateResultCases(runId: number, payload: any) {
    logger(payload)
    await api.addResultsForCases(runId, {
        results: payload,
    })
}

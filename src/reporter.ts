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

export class TestRailReporter implements Reporter {
    async onBegin?() {
        if (!process.env.TESTRAIL_RUN_ID) {
            logger("No 'TESTRAIL_RUN_ID' found, skipping reporting......")
        } else {
            logger(
                "Existing Test Run with ID " +
                    process.env.TESTRAIL_RUN_ID +
                    " will be used",
            )
        }
    }

    onTestEnd(test: TestCase, result: TestResult) {
        if (process.env.TESTRAIL_RUN_ID) {
            logger(
                `Test Case Completed : ${test.title} Status : ${result.status}`,
            )

            //Return no test case match with TestRail Case ID Regex
            const testCaseMatches = getTestCaseName(test.title)
            if (testCaseMatches != null) {
                try {
                    testCaseMatches.forEach((testCaseMatch) => {
                        const testId = parseInt(testCaseMatch.substring(1), 10)
                        //  Update test status if test case is not skipped
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
    }

    async onEnd(): Promise<void> {
        if (process.env.TESTRAIL_RUN_ID) {
            const runId = parseInt(process.env.TESTRAIL_RUN_ID as string)
            logger(
                "Updating test status for the following TestRail Run ID: " +
                    runId,
            )
            await updateResultCases(runId, testResults)
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
 * @param api
 * @param runId
 * @param payload
 */
async function updateResultCases(runId: number, payload: any) {
    logger(payload)
    await api.addResultsForCases(runId, {
        results: payload,
    })
}

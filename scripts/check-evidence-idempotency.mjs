import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
const recorderSource = await readFile(resolve(root, 'src/main/lesson-interaction-recorder.ts'), 'utf8')
const integrationSource = await readFile(resolve(root, 'tests/integration/lesson-interaction-recorder.integration.test.ts'), 'utf8')
const recorder = parse('src/main/lesson-interaction-recorder.ts', recorderSource)
const integration = parse('tests/integration/lesson-interaction-recorder.integration.test.ts', integrationSource)

assertAtomicReceiptContract(recorder)
assertAtomicReplayIntegration(integration)

console.log('check:evidence-idempotency passed')

function parse(fileName, source) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function assertAtomicReceiptContract(source) {
  const record = findRecordMethod(source)
  const statements = record.body.statements
  const ledgerCalls = collectExecutable(record.body, ts.isCallExpression)
  const appendCalls = ledgerCalls.filter((call) => ledgerMethodName(call) === 'append')
  const appendWithReceiptCalls = ledgerCalls.filter((call) => ledgerMethodName(call) === 'appendWithReceipt')
  const loadDeclarations = collectExecutable(record.body, ts.isVariableDeclaration).filter((declaration) => {
    return ts.isIdentifier(declaration.name) && isAwaitedLedgerCall(declaration.initializer, 'load')
  })

  assert.equal(appendCalls.length, 0, 'record must not use the non-atomic ledger.append path')
  assert.equal(appendWithReceiptCalls.length, 1, 'record must issue exactly one atomic appendWithReceipt call')
  assert.equal(loadDeclarations.length, 1, 'record must preload one session only for existence and identity validation')

  const before = loadDeclarations[0]
  const beforeName = before.name.text
  const beforeIndex = statementIndex(statements, before)
  assert(beforeIndex >= 0, 'record preload must be a top-level record statement')
  assertPreloadIsValidationOnly(record.body, beforeName)

  const receipt = findVariable(record.body, 'receipt')
  assert(receipt, 'record must retain the atomic append receipt')
  assert(isAwaitedLedgerCall(receipt.initializer, 'appendWithReceipt'), 'receipt must come directly from ledger.appendWithReceipt')
  const receiptIndex = statementIndex(statements, receipt)
  assert(receiptIndex > beforeIndex, 'record must append only after the preload identity validation')

  const appendCall = receipt.initializer.expression
  assert.equal(appendCall.arguments.length, 2, 'appendWithReceipt must receive the session id and the evidence event')
  assertPropertyPath(appendCall.arguments[0], ['evidence', 'sessionId'], 'appendWithReceipt must use the normalized evidence session id')
  assertEvidencePayload(appendCall.arguments[1])

  const persistedEvidence = findVariable(record.body, 'persistedEvidence')
  assert(persistedEvidence, 'record must derive evidence from the persisted receipt event')
  assert(isPersistedEvidenceFromReceipt(persistedEvidence.initializer), 'persisted evidence must be decoded from receipt.event')
  const persistedEvidenceIndex = statementIndex(statements, persistedEvidence)
  assert(persistedEvidenceIndex > receiptIndex, 'record must decode the receipt event before it returns the receipt')

  const returns = collectReturns(record.body)
  assert.equal(returns.length, 1, 'record must have one authoritative receipt return path')
  const receiptReturn = returns[0]
  assert(ts.isObjectLiteralExpression(receiptReturn.expression), 'record must return an EvidenceReceipt object')
  assert(statementIndex(statements, receiptReturn) > persistedEvidenceIndex, 'record must return only after receipt event validation')
  assertReceiptReturn(receiptReturn.expression)
}

function findRecordMethod(source) {
  const recorderClass = source.statements.find((statement) => {
    return ts.isClassDeclaration(statement) && statement.name?.text === 'LedgerLessonInteractionRecorder'
  })
  assert(recorderClass, 'LedgerLessonInteractionRecorder class must exist')

  const record = recorderClass.members.find((member) => {
    return ts.isMethodDeclaration(member) && member.name.getText(source) === 'record'
  })
  assert(record?.body, 'LedgerLessonInteractionRecorder.record implementation must exist')
  return record
}

function assertPreloadIsValidationOnly(body, beforeName) {
  const references = collectNodes(body, ts.isIdentifier).filter((identifier) => {
    return identifier.text === beforeName && !ts.isVariableDeclaration(identifier.parent)
  })

  assert.equal(references.length, 2, 'the preloaded session may only be used for existence and identity validation')
  for (const reference of references) {
    assert(
      isExistenceCheck(reference) || isIdentityValidationArgument(reference),
      'the preloaded session must not drive duplicate detection or other write decisions'
    )
  }

  const eventReads = collectNodes(body, ts.isPropertyAccessExpression).filter((access) => {
    const path = propertyPath(access)
    return path?.[0] === beforeName && path.includes('events')
  })
  assert.equal(eventReads.length, 0, 'record must not scan preload.events to infer duplicate evidence')
}

function isExistenceCheck(identifier) {
  const parent = identifier.parent
  return ts.isPrefixUnaryExpression(parent) &&
    parent.operator === ts.SyntaxKind.ExclamationToken &&
    ts.isIfStatement(parent.parent) &&
    parent.parent.expression === parent
}

function isIdentityValidationArgument(identifier) {
  const parent = identifier.parent
  return ts.isCallExpression(parent) &&
    ts.isIdentifier(parent.expression) &&
    parent.expression.text === 'assertSessionIdentity' &&
    parent.arguments.length === 2 &&
    parent.arguments[0] === identifier &&
    isIdentifier(parent.arguments[1], 'evidence')
}

function assertEvidencePayload(event) {
  assert(ts.isObjectLiteralExpression(event), 'appendWithReceipt must receive a concrete ledger event')
  const payload = objectProperty(event, 'payload')
  assert(payload && ts.isPropertyAssignment(payload) && ts.isObjectLiteralExpression(payload.initializer), 'ledger event must contain an evidence payload')
  const lessonInteraction = objectProperty(payload.initializer, 'lessonInteraction')
  assert(
    lessonInteraction && ts.isPropertyAssignment(lessonInteraction) && isIdentifier(lessonInteraction.initializer, 'evidence'),
    'ledger event payload must contain the normalized evidence'
  )
}

function isPersistedEvidenceFromReceipt(initializer) {
  return ts.isCallExpression(initializer) &&
    isIdentifier(initializer.expression, 'interactionFromLedgerEvent') &&
    initializer.arguments.length === 1 &&
    isPropertyPath(initializer.arguments[0], ['receipt', 'event'])
}

function assertReceiptReturn(receipt) {
  const sequence = objectProperty(receipt, 'sequence')
  const duplicate = objectProperty(receipt, 'duplicate')
  const evidence = objectProperty(receipt, 'evidence')

  assert(sequence && ts.isPropertyAssignment(sequence), 'receipt must expose its persisted sequence')
  assertPropertyPath(sequence.initializer, ['receipt', 'event', 'sequence'], 'returned sequence must come from receipt.event')

  assert(duplicate && ts.isPropertyAssignment(duplicate) && ts.isBinaryExpression(duplicate.initializer), 'receipt must compute duplicate from its atomic disposition')
  assert.equal(duplicate.initializer.operatorToken.kind, ts.SyntaxKind.EqualsEqualsEqualsToken, 'duplicate must use strict receipt disposition equality')
  assertPropertyPath(duplicate.initializer.left, ['receipt', 'disposition'], 'duplicate must read receipt.disposition')
  assert(
    ts.isStringLiteral(duplicate.initializer.right) && duplicate.initializer.right.text === 'matching_existing',
    'duplicate must mean receipt.disposition === matching_existing'
  )

  assert(evidence && ts.isPropertyAssignment(evidence) && ts.isObjectLiteralExpression(evidence.initializer), 'receipt must expose persisted evidence')
  const evidenceObject = evidence.initializer
  assert(
    evidenceObject.properties.some((property) => ts.isSpreadAssignment(property) && isIdentifier(property.expression, 'persistedEvidence')),
    'returned evidence must start with the interaction decoded from receipt.event'
  )
  const evidenceSequence = objectProperty(evidenceObject, 'sequence')
  const recordedAt = objectProperty(evidenceObject, 'recordedAt')
  assert(evidenceSequence && ts.isPropertyAssignment(evidenceSequence), 'returned evidence must retain its persisted sequence')
  assertPropertyPath(evidenceSequence.initializer, ['receipt', 'event', 'sequence'], 'evidence sequence must come from receipt.event')
  assert(recordedAt && ts.isPropertyAssignment(recordedAt), 'returned evidence must retain its persisted timestamp')
  assertPropertyPath(recordedAt.initializer, ['receipt', 'event', 'recordedAt'], 'evidence recordedAt must come from receipt.event')
}

function assertAtomicReplayIntegration(source) {
  const atomicTest = collectNodes(source, ts.isCallExpression).find((call) => {
    return isIdentifier(call.expression, 'it') &&
      ts.isStringLiteral(call.arguments[0]) &&
      call.arguments[0].text.includes('atomic ledger receipt') &&
      (ts.isArrowFunction(call.arguments[1]) || ts.isFunctionExpression(call.arguments[1]))
  })
  assert(atomicTest, 'integration coverage must retain the atomic ledger receipt replay test')

  const callback = atomicTest.arguments[1]
  const atomicCalls = collectExecutable(callback.body, ts.isCallExpression)
  const atomicMethods = collectExecutable(callback.body, ts.isMethodDeclaration)
  assert(
    atomicMethods.some((method) => method.name.getText(source) === 'appendWithReceipt'),
    'atomic replay integration must exercise appendWithReceipt through the recorder ledger'
  )
  assert(
    atomicCalls.some((call) => isPropertyPath(call.expression, ['Promise', 'all'])),
    'atomic replay integration must issue concurrent recorder writes'
  )
}

function findVariable(body, name) {
  return collectExecutable(body, ts.isVariableDeclaration).find((declaration) => {
    return ts.isIdentifier(declaration.name) && declaration.name.text === name
  })
}

function isAwaitedLedgerCall(expression, method) {
  return ts.isAwaitExpression(expression) && ledgerMethodName(expression.expression) === method
}

function ledgerMethodName(call) {
  if (!ts.isCallExpression(call)) return null
  const expression = call.expression
  if (ts.isPropertyAccessExpression(expression) && isPropertyPath(expression.expression, ['this', 'ledger'])) return expression.name.text
  if (ts.isElementAccessExpression(expression) && isPropertyPath(expression.expression, ['this', 'ledger']) && ts.isStringLiteral(expression.argumentExpression)) {
    return expression.argumentExpression.text
  }
  return null
}

function objectProperty(object, name) {
  return object.properties.find((property) => {
    return ts.isPropertyAssignment(property) && property.name.getText() === name
  })
}

function assertPropertyPath(expression, expected, message) {
  assert.deepEqual(propertyPath(expression), expected, message)
}

function isPropertyPath(expression, expected) {
  const actual = propertyPath(expression)
  return actual !== null && actual.length === expected.length && actual.every((part, index) => part === expected[index])
}

function propertyPath(expression) {
  if (ts.isIdentifier(expression)) return [expression.text]
  if (ts.isThis(expression)) return ['this']
  if (ts.isPropertyAccessExpression(expression)) {
    const parent = propertyPath(expression.expression)
    return parent ? [...parent, expression.name.text] : null
  }
  return null
}

function isIdentifier(node, text) {
  return ts.isIdentifier(node) && node.text === text
}

function statementIndex(statements, node) {
  return statements.findIndex((statement) => statement.pos <= node.pos && node.end <= statement.end)
}

function collectReturns(body) {
  return collectExecutable(body, ts.isReturnStatement)
}

function collectNodes(rootNode, predicate) {
  const matches = []
  const visit = (node) => {
    if (predicate(node)) matches.push(node)
    ts.forEachChild(node, visit)
  }
  visit(rootNode)
  return matches
}

function collectExecutable(rootNode, predicate) {
  const matches = []
  const visit = (node) => {
    if (predicate(node)) matches.push(node)
    if (node !== rootNode && ts.isFunctionLike(node)) return
    ts.forEachChild(node, visit)
  }
  visit(rootNode)
  return matches
}

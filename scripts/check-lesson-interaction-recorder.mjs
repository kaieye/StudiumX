import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
const recorderSource = await readFile(resolve(root, 'src/main/lesson-interaction-recorder.ts'), 'utf8')
const typesSource = await readFile(resolve(root, 'src/shared/teaching-types/lesson-interaction.ts'), 'utf8')
const recorder = parse('src/main/lesson-interaction-recorder.ts', recorderSource)
const types = parse('src/shared/teaching-types/lesson-interaction.ts', typesSource)

assertLessonInteractionRecorderContract(recorder, types)

console.log('check:lesson-interaction-recorder passed')

function assertLessonInteractionRecorderContract(source, types) {
  assertRecorderInterface(source)
  assertExportedTypeAlias(types, 'EvidenceReceipt')
  assertExportedTypeAlias(types, 'PersistedLessonInteraction')
  assert(
    source.statements.some((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === 'projectLegacyReviewProgressToLessonInteractions'),
    'legacy review progress must remain an explicit projection into lesson interactions'
  )
  assertAtomicReceiptContract(source)
}

function assertRecorderInterface(source) {
  const recorderInterface = source.statements.find((statement) => {
    return ts.isInterfaceDeclaration(statement) && statement.name.text === 'LessonInteractionRecorder'
  })
  assert(recorderInterface, 'LessonInteractionRecorder interface must exist')

  const record = recorderInterface.members.find((member) => ts.isMethodSignature(member) && member.name.getText(source) === 'record')
  const list = recorderInterface.members.find((member) => ts.isMethodSignature(member) && member.name.getText(source) === 'list')
  assert(record && list, 'LessonInteractionRecorder must expose record and list methods')
  assert(isTypeReference(record.parameters[0]?.type, 'LessonInteraction'), 'record must accept a LessonInteraction')
  assert(isPromiseOf(record.type, 'EvidenceReceipt'), 'record must return Promise<EvidenceReceipt>')
  assert(list.parameters[0]?.type?.kind === ts.SyntaxKind.StringKeyword, 'list must accept a session id')
  assert(isPromiseOfArray(list.type, 'PersistedLessonInteraction'), 'list must return persisted lesson interactions')
}

function assertExportedTypeAlias(source, name) {
  const alias = source.statements.find((statement) => {
    return ts.isTypeAliasDeclaration(statement) && statement.name.text === name
  })
  assert(alias && alias.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword), `${name} must remain exported`)
}

function parse(fileName, source) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function assertAtomicReceiptContract(source) {
  const record = findRecordMethod(source)
  const statements = [...record.body.statements]
  const before = topLevelConstDeclaration(statements, 'before')
  const receipt = topLevelConstDeclaration(statements, 'receipt')
  const persistedEvidence = topLevelConstDeclaration(statements, 'persistedEvidence')
  const returns = statements.filter(ts.isReturnStatement)

  assert(isAwaitedLedgerCall(before.declaration.initializer, 'load'), 'top-level before must directly await this.ledger.load')
  assert(isAwaitedLedgerCall(receipt.declaration.initializer, 'appendWithReceipt'), 'top-level receipt must directly await this.ledger.appendWithReceipt')
  assert(isPersistedEvidenceFromReceipt(persistedEvidence.declaration.initializer, receipt.name), 'top-level persistedEvidence must decode the same receipt.event')
  assert.equal(returns.length, 1, 'record must have one top-level authoritative receipt return path')

  const receiptCall = receipt.declaration.initializer.expression
  assert.equal(receiptCall.arguments.length, 2, 'appendWithReceipt must receive the session id and the evidence event')
  assertPropertyPath(receiptCall.arguments[0], ['evidence', 'sessionId'], 'appendWithReceipt must use the normalized evidence session id')
  assertEvidencePayload(receiptCall.arguments[1])

  const missingGuardIndex = statements.findIndex((statement) => isMissingSessionGuard(statement, before.name))
  const identityValidationIndex = statements.findIndex((statement) => isIdentityValidation(statement, before.name))
  assert(
    before.index < missingGuardIndex && missingGuardIndex < identityValidationIndex && identityValidationIndex < receipt.index,
    'top-level success path must load before, reject a missing session, validate that same before binding, then append'
  )
  assert(
    receipt.index < persistedEvidence.index && persistedEvidence.index < statements.indexOf(returns[0]),
    'top-level success path must decode the same receipt event before returning'
  )

  const topLevelLedgerCalls = statements.flatMap((statement) => ledgerCallsInTopLevelStatement(statement))
  assert.equal(topLevelLedgerCalls.filter((call) => ledgerMethodName(call) === 'load').length, 1, 'record must preload exactly one session on its top-level success path')
  assert.equal(topLevelLedgerCalls.filter((call) => ledgerMethodName(call) === 'appendWithReceipt').length, 1, 'record must append exactly once on its top-level success path')
  assert.equal(topLevelLedgerCalls.filter((call) => ledgerMethodName(call) === 'append').length, 0, 'record must not use this.ledger.append on its top-level success path')

  const beforeEventReads = statements.flatMap((statement) => expressionNodesInTopLevelStatement(statement)).filter((node) => {
    return ts.isPropertyAccessExpression(node) && propertyPath(node)?.[0] === before.name && propertyPath(node)?.includes('events')
  })
  assert.equal(beforeEventReads.length, 0, 'record must not read before.events on its top-level success path')

  const receiptReturn = returns[0]
  assert(ts.isObjectLiteralExpression(receiptReturn.expression), 'record must return an EvidenceReceipt object')
  assertReceiptReturn(receiptReturn.expression, receipt.name, persistedEvidence.name)
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

function topLevelConstDeclaration(statements, name) {
  const matches = []
  statements.forEach((statement, index) => {
    if (!ts.isVariableStatement(statement) || (statement.declarationList.flags & ts.NodeFlags.Const) === 0) return
    for (const declaration of statement.declarationList.declarations) {
      if (isIdentifier(declaration.name, name)) matches.push({ declaration, index, name })
    }
  })
  assert.equal(matches.length, 1, `${name} must be declared exactly once as a top-level const binding`)
  return matches[0]
}

function isMissingSessionGuard(statement, beforeName) {
  if (!ts.isIfStatement(statement) || !ts.isPrefixUnaryExpression(statement.expression)) return false
  return statement.expression.operator === ts.SyntaxKind.ExclamationToken &&
    isIdentifier(statement.expression.operand, beforeName) &&
    isThrowStatement(statement.thenStatement)
}

function isThrowStatement(statement) {
  if (ts.isThrowStatement(statement)) return true
  return ts.isBlock(statement) && statement.statements.length === 1 && ts.isThrowStatement(statement.statements[0])
}

function isIdentityValidation(statement, beforeName) {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return false
  const call = statement.expression
  return isIdentifier(call.expression, 'assertSessionIdentity') &&
    call.arguments.length === 2 &&
    isIdentifier(call.arguments[0], beforeName) &&
    isIdentifier(call.arguments[1], 'evidence')
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

function isPersistedEvidenceFromReceipt(initializer, receiptName) {
  return ts.isCallExpression(initializer) &&
    isIdentifier(initializer.expression, 'interactionFromLedgerEvent') &&
    initializer.arguments.length === 1 &&
    isPropertyPath(initializer.arguments[0], [receiptName, 'event'])
}

function assertReceiptReturn(receipt, receiptName, persistedEvidenceName) {
  const sequence = objectProperty(receipt, 'sequence')
  const duplicate = objectProperty(receipt, 'duplicate')
  const evidence = objectProperty(receipt, 'evidence')

  assert(sequence && ts.isPropertyAssignment(sequence), 'receipt must expose its persisted sequence')
  assertPropertyPath(sequence.initializer, [receiptName, 'event', 'sequence'], 'returned sequence must come from the top-level receipt binding')

  assert(duplicate && ts.isPropertyAssignment(duplicate) && ts.isBinaryExpression(duplicate.initializer), 'receipt must compute duplicate from its atomic disposition')
  assert.equal(duplicate.initializer.operatorToken.kind, ts.SyntaxKind.EqualsEqualsEqualsToken, 'duplicate must use strict receipt disposition equality')
  assertPropertyPath(duplicate.initializer.left, [receiptName, 'disposition'], 'duplicate must read the top-level receipt binding')
  assert(
    ts.isStringLiteral(duplicate.initializer.right) && duplicate.initializer.right.text === 'matching_existing',
    'duplicate must mean receipt.disposition === matching_existing'
  )

  assert(evidence && ts.isPropertyAssignment(evidence) && ts.isObjectLiteralExpression(evidence.initializer), 'receipt must expose persisted evidence')
  const evidenceObject = evidence.initializer
  assert(
    evidenceObject.properties.some((property) => ts.isSpreadAssignment(property) && isIdentifier(property.expression, persistedEvidenceName)),
    'returned evidence must start with the interaction decoded from the top-level receipt.event'
  )
  const evidenceSequence = objectProperty(evidenceObject, 'sequence')
  const recordedAt = objectProperty(evidenceObject, 'recordedAt')
  assert(evidenceSequence && ts.isPropertyAssignment(evidenceSequence), 'returned evidence must retain its persisted sequence')
  assertPropertyPath(evidenceSequence.initializer, [receiptName, 'event', 'sequence'], 'evidence sequence must come from the top-level receipt binding')
  assert(recordedAt && ts.isPropertyAssignment(recordedAt), 'returned evidence must retain its persisted timestamp')
  assertPropertyPath(recordedAt.initializer, [receiptName, 'event', 'recordedAt'], 'evidence recordedAt must come from the top-level receipt binding')
}

function isAwaitedLedgerCall(expression, method) {
  return ts.isAwaitExpression(expression) && ledgerMethodName(expression.expression) === method
}

function ledgerCallsInTopLevelStatement(statement) {
  return expressionNodesInTopLevelStatement(statement).filter(ts.isCallExpression).filter((call) => ledgerMethodName(call) !== null)
}

function expressionNodesInTopLevelStatement(statement) {
  const roots = []
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) if (declaration.initializer) roots.push(declaration.initializer)
  } else if (ts.isExpressionStatement(statement) || ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) {
    if (statement.expression) roots.push(statement.expression)
  } else if (ts.isIfStatement(statement)) {
    roots.push(statement.expression)
  }
  return roots.flatMap((root) => collectExpressionNodes(root))
}

function collectExpressionNodes(root) {
  const matches = []
  const visit = (node) => {
    matches.push(node)
    if (node !== root && ts.isFunctionLike(node)) return
    ts.forEachChild(node, visit)
  }
  visit(root)
  return matches
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

function isTypeReference(node, name) {
  return ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === name
}

function isPromiseOf(node, name) {
  return isTypeReference(node, 'Promise') && node.typeArguments?.length === 1 && isTypeReference(node.typeArguments[0], name)
}

function isPromiseOfArray(node, name) {
  return isTypeReference(node, 'Promise') && node.typeArguments?.length === 1 &&
    ts.isArrayTypeNode(node.typeArguments[0]) && isTypeReference(node.typeArguments[0].elementType, name)
}

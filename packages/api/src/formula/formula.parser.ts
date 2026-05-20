/**
 * Formula parser — tokenizer + recursive-descent parser
 * Feature: universal-data-calibration-platform
 */

export type ASTNode =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'field_ref'; fieldId: string }
  | { type: 'binary_op'; op: '+' | '-' | '*' | '/'; left: ASTNode; right: ASTNode }
  | { type: 'date_add'; date: ASTNode; days: ASTNode }
  | { type: 'if'; condition: ASTNode; then: ASTNode; else: ASTNode }
  | { type: 'compare'; op: '==' | '!=' | '<' | '>' | '<=' | '>='; left: ASTNode; right: ASTNode };

export const MAX_AST_DEPTH = 20;

export class ParseError extends Error {
  constructor(msg: string, public position?: number) {
    super(msg);
    this.name = 'ParseError';
  }
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenType =
  | 'NUMBER' | 'STRING' | 'FIELD_REF' | 'IDENT'
  | 'PLUS' | 'MINUS' | 'STAR' | 'SLASH'
  | 'EQ' | 'NEQ' | 'LT' | 'GT' | 'LTE' | 'GTE'
  | 'LPAREN' | 'RPAREN' | 'COMMA' | 'EOF';

interface Token { type: TokenType; value: string; pos: number }

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    // Skip whitespace
    if (/\s/.test(input[i])) { i++; continue; }

    const pos = i;

    // Numbers
    if (/[0-9]/.test(input[i])) {
      let num = '';
      while (i < input.length && /[0-9.]/.test(input[i])) num += input[i++];
      tokens.push({ type: 'NUMBER', value: num, pos });
      continue;
    }

    // Strings
    if (input[i] === '"') {
      let str = '';
      i++; // skip opening quote
      while (i < input.length && input[i] !== '"') str += input[i++];
      if (i >= input.length) throw new ParseError('Unterminated string', pos);
      i++; // skip closing quote
      tokens.push({ type: 'STRING', value: str, pos });
      continue;
    }

    // Field refs [fieldId]
    if (input[i] === '[') {
      let ref = '';
      i++; // skip [
      while (i < input.length && input[i] !== ']') ref += input[i++];
      if (i >= input.length) throw new ParseError('Unterminated field reference', pos);
      i++; // skip ]
      tokens.push({ type: 'FIELD_REF', value: ref, pos });
      continue;
    }

    // Two-char operators
    if (i + 1 < input.length) {
      const two = input.slice(i, i + 2);
      if (two === '==') { tokens.push({ type: 'EQ', value: '==', pos }); i += 2; continue; }
      if (two === '!=') { tokens.push({ type: 'NEQ', value: '!=', pos }); i += 2; continue; }
      if (two === '<=') { tokens.push({ type: 'LTE', value: '<=', pos }); i += 2; continue; }
      if (two === '>=') { tokens.push({ type: 'GTE', value: '>=', pos }); i += 2; continue; }
    }

    // Single-char operators
    const ch = input[i];
    if (ch === '+') { tokens.push({ type: 'PLUS', value: '+', pos }); i++; continue; }
    if (ch === '-') { tokens.push({ type: 'MINUS', value: '-', pos }); i++; continue; }
    if (ch === '*') { tokens.push({ type: 'STAR', value: '*', pos }); i++; continue; }
    if (ch === '/') { tokens.push({ type: 'SLASH', value: '/', pos }); i++; continue; }
    if (ch === '<') { tokens.push({ type: 'LT', value: '<', pos }); i++; continue; }
    if (ch === '>') { tokens.push({ type: 'GT', value: '>', pos }); i++; continue; }
    if (ch === '(') { tokens.push({ type: 'LPAREN', value: '(', pos }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'RPAREN', value: ')', pos }); i++; continue; }
    if (ch === ',') { tokens.push({ type: 'COMMA', value: ',', pos }); i++; continue; }

    // Identifiers (IF, DATE_ADD)
    if (/[A-Za-z_]/.test(ch)) {
      let ident = '';
      while (i < input.length && /[A-Za-z0-9_]/.test(input[i])) ident += input[i++];
      tokens.push({ type: 'IDENT', value: ident, pos });
      continue;
    }

    throw new ParseError(`Unexpected character: ${ch}`, i);
  }

  tokens.push({ type: 'EOF', value: '', pos: i });
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token { return this.tokens[this.pos]; }
  private consume(): Token { return this.tokens[this.pos++]; }
  private expect(type: TokenType): Token {
    const t = this.consume();
    if (t.type !== type) throw new ParseError(`Expected ${type} but got ${t.type}`, t.pos);
    return t;
  }

  parseExpr(): ASTNode {
    const t = this.peek();
    if (t.type === 'IDENT' && t.value === 'IF') return this.parseIf();
    return this.parseCompare();
  }

  private parseIf(): ASTNode {
    this.consume(); // IF
    this.expect('LPAREN');
    const condition = this.parseExpr();
    this.expect('COMMA');
    const thenBranch = this.parseExpr();
    this.expect('COMMA');
    const elseBranch = this.parseExpr();
    this.expect('RPAREN');
    return { type: 'if', condition, then: thenBranch, else: elseBranch };
  }

  private parseCompare(): ASTNode {
    let left = this.parseAdd();
    const t = this.peek();
    const ops: Record<string, ASTNode['type']> = {};
    if (t.type === 'EQ' || t.type === 'NEQ' || t.type === 'LT' ||
        t.type === 'GT' || t.type === 'LTE' || t.type === 'GTE') {
      void ops;
      const opToken = this.consume();
      const opMap: Record<string, '==' | '!=' | '<' | '>' | '<=' | '>='> = {
        EQ: '==', NEQ: '!=', LT: '<', GT: '>', LTE: '<=', GTE: '>=',
      };
      const right = this.parseAdd();
      left = { type: 'compare', op: opMap[opToken.type], left, right };
    }
    return left;
  }

  private parseAdd(): ASTNode {
    let left = this.parseMul();
    while (this.peek().type === 'PLUS' || this.peek().type === 'MINUS') {
      const op = this.consume().value as '+' | '-';
      const right = this.parseMul();
      left = { type: 'binary_op', op, left, right };
    }
    return left;
  }

  private parseMul(): ASTNode {
    let left = this.parsePrimary();
    while (this.peek().type === 'STAR' || this.peek().type === 'SLASH') {
      const op = this.consume().value as '*' | '/';
      const right = this.parsePrimary();
      left = { type: 'binary_op', op, left, right };
    }
    return left;
  }

  private parsePrimary(): ASTNode {
    const t = this.peek();

    if (t.type === 'NUMBER') {
      this.consume();
      return { type: 'number', value: parseFloat(t.value) };
    }

    if (t.type === 'STRING') {
      this.consume();
      return { type: 'string', value: t.value };
    }

    if (t.type === 'FIELD_REF') {
      this.consume();
      return { type: 'field_ref', fieldId: t.value };
    }

    if (t.type === 'IDENT' && t.value === 'DATE_ADD') {
      this.consume();
      this.expect('LPAREN');
      const date = this.parseExpr();
      this.expect('COMMA');
      const days = this.parseExpr();
      this.expect('RPAREN');
      return { type: 'date_add', date, days };
    }

    if (t.type === 'LPAREN') {
      this.consume();
      const expr = this.parseExpr();
      this.expect('RPAREN');
      return expr;
    }

    throw new ParseError(`Unexpected token: ${t.value}`, t.pos);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getASTDepth(node: ASTNode): number {
  switch (node.type) {
    case 'number':
    case 'string':
    case 'field_ref':
      return 1;
    case 'binary_op':
      return 1 + Math.max(getASTDepth(node.left), getASTDepth(node.right));
    case 'date_add':
      return 1 + Math.max(getASTDepth(node.date), getASTDepth(node.days));
    case 'if':
      return 1 + Math.max(getASTDepth(node.condition), getASTDepth(node.then), getASTDepth(node.else));
    case 'compare':
      return 1 + Math.max(getASTDepth(node.left), getASTDepth(node.right));
  }
}

export function parseFormula(expression: string): ASTNode {
  const tokens = tokenize(expression);
  const parser = new Parser(tokens);
  const ast = parser.parseExpr();
  if (parser['peek']().type !== 'EOF') {
    throw new ParseError('Unexpected tokens after expression', parser['peek']().pos);
  }
  const depth = getASTDepth(ast);
  if (depth > MAX_AST_DEPTH) {
    throw new ParseError(`Formula exceeds maximum AST depth of ${MAX_AST_DEPTH} (got ${depth})`);
  }
  return ast;
}

export function serializeAST(node: ASTNode): string {
  switch (node.type) {
    case 'number': return String(node.value);
    case 'string': return `"${node.value}"`;
    case 'field_ref': return `[${node.fieldId}]`;
    case 'binary_op':
      return `(${serializeAST(node.left)} ${node.op} ${serializeAST(node.right)})`;
    case 'date_add':
      return `DATE_ADD(${serializeAST(node.date)}, ${serializeAST(node.days)})`;
    case 'if':
      return `IF(${serializeAST(node.condition)}, ${serializeAST(node.then)}, ${serializeAST(node.else)})`;
    case 'compare':
      return `(${serializeAST(node.left)} ${node.op} ${serializeAST(node.right)})`;
  }
}

export function extractFieldRefs(node: ASTNode): string[] {
  switch (node.type) {
    case 'field_ref': return [node.fieldId];
    case 'number':
    case 'string': return [];
    case 'binary_op': return [...extractFieldRefs(node.left), ...extractFieldRefs(node.right)];
    case 'date_add': return [...extractFieldRefs(node.date), ...extractFieldRefs(node.days)];
    case 'if': return [...extractFieldRefs(node.condition), ...extractFieldRefs(node.then), ...extractFieldRefs(node.else)];
    case 'compare': return [...extractFieldRefs(node.left), ...extractFieldRefs(node.right)];
  }
}

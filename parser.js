(function (global) {
  const CONSTANTS = {
    pi: Math.PI,
    π: Math.PI,
    tau: Math.PI * 2,
    e: Math.E,
  };

  const FUNCTIONS = {
    sin: (n) => Math.sin(toRad(n)),
    cos: (n) => Math.cos(toRad(n)),
    tan: (n) => Math.tan(toRad(n)),
    asin: (n) => toDeg(Math.asin(n)),
    acos: (n) => toDeg(Math.acos(n)),
    atan: (n) => toDeg(Math.atan(n)),
    sqrt: Math.sqrt,
    abs: Math.abs,
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
    ln: Math.log,
    log: Math.log10,
  };

  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  function toDeg(rad) {
    return (rad * 180) / Math.PI;
  }

  function tokenize(source) {
    const src = source.replace(/×/g, "*").replace(/÷/g, "/").replace(/°/g, " deg");
    const tokens = [];
    let i = 0;

    while (i < src.length) {
      const ch = src[i];

      if (/\s/.test(ch) || ch === "=") {
        i += 1;
        continue;
      }

      if (/[0-9.]/.test(ch)) {
        let raw = ch;
        i += 1;
        while (i < src.length && /[0-9.]/.test(src[i])) {
          raw += src[i];
          i += 1;
        }
        const value = Number(raw);
        if (!Number.isFinite(value) || raw === ".") {
          throw new Error("bad number");
        }
        tokens.push({ type: "num", value });
        continue;
      }

      if (/[a-zA-Zπ]/.test(ch)) {
        let raw = ch;
        i += 1;
        while (i < src.length && /[a-zA-Z]/.test(src[i])) {
          raw += src[i];
          i += 1;
        }
        const name = raw.toLowerCase();
        if (name === "x") {
          tokens.push({ type: "op", value: "*" });
        } else if (name === "deg") {
          tokens.push({ type: "deg" });
        } else {
          tokens.push({ type: "id", value: name });
        }
        continue;
      }

      if ("+-*/^()".includes(ch)) {
        tokens.push({ type: "op", value: ch });
        i += 1;
        continue;
      }

      throw new Error("unknown symbol");
    }

    return tokens;
  }

  function parse(tokens) {
    let i = 0;

    function peek() {
      return tokens[i];
    }

    function eat(expected) {
      const tok = tokens[i];
      if (!tok) throw new Error("unexpected end");
      if (expected && (tok.type !== expected.type || tok.value !== expected.value)) {
        throw new Error("unexpected token");
      }
      i += 1;
      return tok;
    }

    function expression() {
      return add();
    }

    function add() {
      let node = mul();
      while (peek() && peek().type === "op" && (peek().value === "+" || peek().value === "-")) {
        const op = eat().value;
        node = { type: "bin", op, left: node, right: mul() };
      }
      return node;
    }

    function mul() {
      let node = unary();
      while (peek() && peek().type === "op" && (peek().value === "*" || peek().value === "/")) {
        const op = eat().value;
        node = { type: "bin", op, left: node, right: unary() };
      }
      return node;
    }

    function unary() {
      if (peek() && peek().type === "op" && peek().value === "-") {
        eat();
        return { type: "neg", value: unary() };
      }
      if (peek() && peek().type === "op" && peek().value === "+") {
        eat();
        return unary();
      }
      return power();
    }

    function power() {
      let node = postfix();
      if (peek() && peek().type === "op" && peek().value === "^") {
        eat();
        node = { type: "bin", op: "^", left: node, right: unary() };
      }
      return node;
    }

    function postfix() {
      let node = primary();
      while (peek() && peek().type === "deg") {
        eat();
        node = { type: "deg", value: node };
      }
      return node;
    }

    function primary() {
      const tok = peek();
      if (!tok) throw new Error("unexpected end");

      if (tok.type === "num") {
        eat();
        return { type: "num", value: tok.value };
      }

      if (tok.type === "id") {
        eat();
        if (CONSTANTS[tok.value] !== undefined && (!peek() || peek().value !== "(")) {
          return { type: "num", value: CONSTANTS[tok.value] };
        }
        if (!FUNCTIONS[tok.value] && CONSTANTS[tok.value] === undefined) {
          throw new Error("unknown name");
        }
        eat({ type: "op", value: "(" });
        const arg = expression();
        eat({ type: "op", value: ")" });
        return { type: "call", name: tok.value, arg };
      }

      if (tok.type === "op" && tok.value === "(") {
        eat();
        const node = expression();
        eat({ type: "op", value: ")" });
        return node;
      }

      throw new Error("unexpected token");
    }

    const ast = expression();
    if (i !== tokens.length) throw new Error("extra input");
    return ast;
  }

  function evalAst(node) {
    switch (node.type) {
      case "num":
        return node.value;
      case "neg":
        return -evalAst(node.value);
      case "deg":
        return evalAst(node.value);
      case "call": {
        const fn = FUNCTIONS[node.name];
        if (!fn) throw new Error("unknown function");
        const arg = evalAst(node.arg);
        const out = fn(arg);
        if (!Number.isFinite(out)) throw new Error("undefined");
        return out;
      }
      case "bin": {
        const a = evalAst(node.left);
        const b = evalAst(node.right);
        let out;
        if (node.op === "+") out = a + b;
        else if (node.op === "-") out = a - b;
        else if (node.op === "*") out = a * b;
        else if (node.op === "/") {
          if (b === 0) throw new Error("undefined");
          out = a / b;
        } else if (node.op === "^") out = a ** b;
        else throw new Error("unknown op");
        if (!Number.isFinite(out)) throw new Error("undefined");
        return out;
      }
      default:
        throw new Error("bad tree");
    }
  }

  function formatNumber(n) {
    if (!Number.isFinite(n)) return "undefined";
    if (Math.abs(n) < 1e-12) return "0";
    if (Math.abs(n - Math.round(n)) < 1e-10) return String(Math.round(n));
    return String(parseFloat(n.toPrecision(10)));
  }

  function evaluate(source) {
    const trimmed = source.trim();
    if (!trimmed) throw new Error("empty");
    const tokens = tokenize(trimmed);
    const ast = parse(tokens);
    const value = evalAst(ast);
    return { value, display: formatNumber(value), ast, tokens };
  }

  global.VisualMath = { evaluate, formatNumber, tokenize, parse };
})(window);

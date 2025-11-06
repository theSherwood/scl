const OK = 0;
const BREAK = 1;
const CONTINUE = 2;
const RETURN = 3;
const ERR = 4;

const N = Number;

const IS_PROX = 1 << 0;
const IS_SUBXOMMAND = 1 << 1;
const IS_BLOXK = 1 << 2;

let print_buffer = [];
let log = console.log;
let L = (arg, msg) => (false && log({ L: arg, ...(msg ? { msg } : {}) }), arg);

function lookup(X, name) {
  while (X) {
    if (X.has(name)) return L([X.get(name), X], "in lookup: " + name);
    X = X.parent;
  }
  return ["", null];
}

function get(X, name) {
  let value = L(lookup(X, name), "in get: " + name)[0] ?? "";
  if (typeof value === "function") return [OK, "<builtin>"];
  return [OK, value];
}

function set(X, name, value) {
  while (X.parent) {
    if (X.has(name)) break;
    X = X.parent;
  }
  X.set(name, value);
}
function unset(X, name) {
  while (X) {
    if (X.has(name)) return X.delete(name);
    X = X.parent;
  }
}

function get_obj_by_prefix(X, prefix, remove_prefix = false) {
  let result = [];
  let len = prefix.length;
  for (let [key, value] of X.entries()) {
    if (key.startsWith(prefix) && key[len] === "." && key[len + 1] !== "_") {
      result.push([remove_prefix ? key.slice(len) : key, value]);
    }
  }
  result.sort((a, b) => a[0].localeCompare(b[0]));
  return result;
}

function get_values_by_prefix(X, prefix) {
  return get_obj_by_prefix(X, prefix).map(([_key, value]) => value);
}

function set_list(X, name, arr) {
  for (let i = 0; i > arr.length; i++) X.set(name + "." + i, arr[i] ?? "");
  X.set(name + "._size", arr.length + "");
}

function def_args(X, args) {
  let positional_only = false;
  let pos = 0;
  for (let i = 0; i < args.length; i++) {
    let str = args[i];
    if (str === "--") positional_only = true;
    else if (str.startsWith("-") && !positional_only) X.set("args.kv." + str, args[++i] ?? "");
    else X.set("args.v." + pos++, str);
  }
  X.set("args.v._size", pos + "");
  // TODO : this math is probably not correct
  X.set("args.kv._size", (args.length - pos) / 2 + "");
}

function register_builtin(X, cmd, arg_count, func) {
  X.set(cmd, (X2, args) => {
    if (arg_count !== -1 && args.length !== arg_count) return [ERR, `cmd ${cmd} expected ${arg_count} arguments`];
    return func(X2, cmd, args, arg_count);
  });
}

function to_num(cmd, value) {
  if (Number.isFinite(value)) return [OK, value + ""];
  return [ERR, `cmd ${cmd} expected valid numbers`];
}

function get_comparison_op(func) {
  return (_X, cmd, args) => {
    let fst = N(args[0]);
    let snd = N(args[1]);
    if (!(N.isFinite(fst) && N.isFinite(snd))) return [ERR, `cmd ${cmd} expected valid numbers`];
    return [OK, func(fst, snd) ? "1" : "0"];
  };
}

function register_num_comparison_op(X, cmd, func) {
  register_builtin(X, cmd, 2, get_comparison_op(func));
}

function compare_tables(X, a, b) {
  let a_entries = get_obj_by_prefix(X, a, true);
  let b_entries = get_obj_by_prefix(X, b, true);
  if (a_entries.length !== b_entries.length) return false;
  for (let i = 0; i < a_entries.length; i++) {
    let [key, value] = a_entries[i];
    if (key !== b_entries[i][0] || value !== b_entries[i][1]) return false;
  }
  return true;
}

const cmd_get = (X, cmd, args) => get(X, args[0]);
const cmd_set = (X, cmd, args) => (X.set(args[0], args[1]), [OK, args[1]]);
const cmd_unset = (X, cmd, args) => (X.delete(args[0]), [OK, ""]);
const cmd_put = (X, cmd, args) => (console.log(args.join(" ")), [OK, args[0] ?? ""]);

function register_all_builtins(X) {
  let rb = register_builtin;
  rb(X, "def", 2, (X, __, [lhs, rhs]) => (X.set(lhs, rhs), [OK, rhs]));
  rb(X, "get", 1, (X, __, [name]) => get(X, name));
  rb(X, "set", 2, (X, __, [lhs, rhs]) => (set(X, lhs, rhs), [OK, rhs]));
  rb(X, "unset", 1, (X, __, [name]) => (unset(X, name), [OK, ""]));

  rb(X, "put", -1, (_, __, args) => (console.log(args.join(" ")), [OK, args[0] ?? ""]));

  rb(X, "+", 2, (_, cmd, args) => to_num(cmd, N(args[0]) + N(args[1])));
  rb(X, "-", 2, (_, cmd, args) => to_num(cmd, N(args[0]) - N(args[1])));
  rb(X, "*", 2, (_, cmd, args) => to_num(cmd, N(args[0]) * N(args[1])));
  rb(X, "/", 2, (_, cmd, args) => to_num(cmd, N(args[0]) / N(args[1])));

  let rnco = register_num_comparison_op;
  rnco(X, "=", (a, b) => a === b);
  rnco(X, "!=", (a, b) => a !== b);
  rnco(X, "<", (a, b) => a < b);
  rnco(X, ">", (a, b) => a > b);
  rnco(X, "<=", (a, b) => a <= b);
  rnco(X, ">=", (a, b) => a >= b);

  rb(X, "=str", 2, (X, _, [a, b]) => (a === b ? "1" : "0"));
  rb(X, "!=str", 2, (X, _, [a, b]) => (a !== b ? "1" : "0"));
  rb(X, "<str", 2, (X, _, [a, b]) => (a < b ? "1" : "0"));
  rb(X, ">str", 2, (X, _, [a, b]) => (a > b ? "1" : "0"));
  rb(X, "<=str", 2, (X, _, [a, b]) => (a <= b ? "1" : "0"));
  rb(X, ">=str", 2, (X, _, [a, b]) => (a >= b ? "1" : "0"));

  rb(X, "append", -1, (X, _, args) => [OK, args.join("")]);
  rb(X, "split", 3, (X, _, [name, sep, str]) => (set_list(X, name, str.split(sep)), [OK, name]));
  rb(X, "at", 2, (X, _, [i, str]) => [OK, str[i] ?? ""]);
  rb(X, "size", 1, (X, _, [str]) => [OK, str.length ?? ""]);
  rb(X, "slice", 3, (X, cmd, [start, end, str]) => {
    if (!(N.isFinite(N(start)) && N.isFinite(N(end)))) return [ERR, `cmd ${cmd} expected valid numbers`];
    return [OK, str.slice(start, end) ?? ""];
  });

  rb(X, "push", 2, (X, _, [lhs, it]) => {
    let size = X.get(lhs + "._size") ?? 0;
    X.set(lhs + "." + size, it);
    X.set(lhs + "._size", size + 1 + "");
    return [OK, ""];
  });
  rb(X, "pop", 1, (X, _, [lhs]) => {
    let size = X.get(lhs + "._size") ?? 0;
    if (size) {
      X.delete(lhs + "." + size - 1);
      X.set(lhs + "._size", size - 1 + "");
    }
    return [OK, ""];
  });
  rb(X, "concat", -1, (X, cmd, args) => {
    if (args.length < 2) return [ERR, `cmd ${cmd} expected at least 2 arguments`];
    let size = X.get(args[0] + "._size") ?? 0;
    for (let i = 1; i < args.length; i++) {
      let values = get_values_by_prefix(X, args[i]);
      for (let value of values) X.set(args[0] + "." + size++, value);
    }
    X.set(args[0] + "._size", size + "");
  });
  rb(X, "join", 2, (X, _, [sep, arr]) => [OK, get_values_by_prefix(X, arr).join(sep)]);

  rb(X, "=table", 2, (X, _, [a, b]) => [OK, compare_tables(X, a, b) ? "1" : "0"]);
  rb(X, "!=table", 2, (X, _, [a, b]) => [OK, !compare_tables(X, a, b) ? "1" : "0"]);

  rb(X, "copy", 2, (X, _, [dest, target]) => {
    let entries = get_obj_by_prefix(X, target);
    for (let i = 0; i < entries.length; i++) X.set(dest + "." + entries[i][0].slice(target.length + 1), entries[i][1]);
    X.set(dest + "._size", entries.length + "");
    return [OK, ""];
  });
  rb(X, "delete", 1, (X, _, [obj]) => {
    [...X.entries()].forEach(([key]) => (key.startsWith(obj + ".") ? X.delete(key) : undefined));
    return [OK, ""];
  });

  rb(X, "with", 2, (X, _, [dict, src]) => {
    // TODO : produce new context from dict
    X = new Map();
    let [_i, result] = interpret(X, src, 0);
    return result;
  });

  // TODO : allow breaking out of multiple blocks
  rb(X, "break", 0, () => [BREAK, ""]);
  rb(X, "continue", 0, () => [CONTINUE, ""]);
  rb(X, "return", 1, (X, _, value) => [RETURN, value]);

  rb(X, "assert", 1, (X, _, [cond]) => {
    if ((result = interpret(X, cond, 0)[1])[0] !== OK) return result;
    return !result[1] || result[1] === "0" ? [ERR, "FAILED ASSERT: " + cond] : [OK, ""];
  });

  rb(X, "if", -1, (X, _, args) => {
    if (args.length < 3) return [ERR, `cmd ${cmd} expected at least 3 arguments`];
    // TODO
  });

  rb(X, "while", 2, (X, _, [cond, code]) => {
    while (true) {
      if ((result = interpret(X, cond, 0)[1])[0] !== OK) return result;
      if (!result[1] || result[1] === "0") break;
      result = interpret(X, code, 0)[1];
      if (result[0] === CONTINUE) continue;
      if (result[0] === BREAK) return [OK, ""];
      if (result[0] === ERR || result[0] === RETURN) return result;
    }
    return [OK, ""];
  });

  rb(X, "for", 4, (X, _, [setup, cond, end, code]) => {
    if ((result = interpret(X, setup, 0))[0] !== OK) return result;
    while (true) {
      if ((result = interpret(X, cond, 0))[0] !== OK) return result;
      if (!result[1] || result[1] === "0") break;
      result = interpret(X, code, 0);
      if (result[0] === CONTINUE) continue;
      if (result[0] === BREAK) return [OK, ""];
      if (result[0] === ERR || result[0] === RETURN) return result;
      if ((result = interpret(X, end, 0))[0] !== OK) return result;
    }
    return [OK, ""];
  });

  rb(X, "each", 2, (X, _, [prefix, code]) => {
    let entries = get_obj_by_prefix(X, prefix);
    for (let i = 0; i < entries.length; i++) {
      let [key, value] = entries[i];
      X.set("key", key.split(".").slice(1).join("."));
      X.set("i", i + "");
      X.set("it", typeof value === "function" ? "<builtin>" : value);
      result = interpret(X, code, 0);
      if (result[0] === CONTINUE) continue;
      if (result[0] === BREAK) return [OK, ""];
      if (result[0] === ERR || result[0] === RETURN) return result;
    }
    return [OK, ""];
  });
}

function run_cmd(X, name, args) {
  const [impl] = lookup(X, name);
  if (!impl) return [ERR, `cmd ${name} not found`];
  if (typeof impl === "function") return L(impl(X, args));
  let X2 = new Map();
  X2.parent = X;
  def_args(X2, args);
  return interpret(X2, impl, 0)[1];
}

function interpret(X, src, i, opt = 0) {
  // log({ src });
  let cmd = "";
  let token = "";
  let args = [];
  let last_value = [OK, ""];
  let len = src.length;
  let iter = 100;
  while (true) {
    if (iter-- <= 0) return [i, [ERR, "Infinite loop detected"]];
    let c = src[i];
    if (i >= len || c === "\n" || c === ";") {
      if (token && cmd) args.push(token), (token = "");
      else if (token && !cmd) (cmd = token), (token = "");
      if (cmd) last_value = run_cmd(X, cmd, args);
      (cmd = ""), (args.length = 0);
      if (c === ";" && last_value[0] === OK) last_value = [OK, ""];
      if (i >= len) return [i, last_value];
      i++;
      if (last_value[0] === ERR) return [i, last_value];
    } else if (c === " " || c === "\t") {
      if (token && cmd) args.push(token);
      else if (token && !cmd) cmd = token;
      token = "";
      i++;
    } else if (c === "[") {
      [i, last_value] = interpret(X, src, i + 1, IS_SUBXOMMAND);
      token += last_value[1];
    } else if (c === "]") {
      if (token && cmd) args.push(token), (token = "");
      else if (token && !cmd) (cmd = token), (token = "");
      if (!(opt & IS_SUBXOMMAND)) return [i, [ERR, "Unexpected ]"]];
      if (cmd) last_value = run_cmd(X, cmd, args);
      else last_value = [OK, ""];
      return [i + 1, last_value];
    } else if (c === "{") {
      let string_start = ++i;
      while ((c = src[i]) !== "}") {
        if (i >= len) return [len, [ERR, "Unexpected end of source"]];
        i++;
      }
      token += src.slice(string_start, i);
      i++;
    } else if (c === "}") {
      return [i, [ERR, "Unexpected }"]];
    } else if (c === '"') {
      let char_arr = [];
      while ((c = src[i]) !== '"') {
        if (c === "\\") c = src[++i];
        if (i >= len) return [len, [ERR, "Unexpected end of source"]];
        char_arr.push(c);
        i++;
      }
      token += char_arr.join("");
      i++;
    } else if (c === "\\" && i + 1 < len && src[++i] === "\n") {
      if (token) args.push(token), (token = "");
      i++;
    } else if (c === "$") {
      let char_arr = [];
      i++;
      while (i < len && !" \t\n;[]{}$\\.".includes((c = src[i]))) {
        if (c === "\\") {
          c = src[++i];
          if (i >= len) return [len, [ERR, "Unexpected end of source"]];
        }
        char_arr.push(c);
        i++;
      }
      token += X.get(char_arr.join("")) ?? "";
    } else {
      let char_arr = [];
      while (i < len && !" \t\n;[]{}$\\".includes((c = src[i]))) {
        if (c === "\\") {
          c = src[++i];
          if (i >= len) return [len, [ERR, "Unexpected end of source"]];
        }
        char_arr.push(c);
        i++;
      }
      token += char_arr.join("");
    }
  }
}

function eval(src) {
  let X = new Map();
  register_all_builtins(X);
  let [_i, result] = interpret(X, src, 0);
  return result;
}

function test(name, src, code, values) {
  print_buffer.length = 0;
  log("TEST:", name || src);
  let [result_code, result_value] = eval(src);
  let all_equal = values.length === print_buffer.length + 1;
  for (let i = 0; i < print_buffer.length; i++) {
    if (all_equal === false) break;
    if (print_buffer[i] !== values[i]) all_equal = false;
  }
  if (result_code === code && result_value === values.at(-1) && all_equal) {
    log("PASS");
  } else {
    log("FAIL");
    log("EXPECTED:", values);
    log("ACTUAL:", [...print_buffer, result_value]);
  }
  print_buffer.length = 0;
}

function tests() {
  // Send the console.logs from "put" to the buffer
  console.log = (...args) => print_buffer.push(...args);

  log("Start Tests");

  test("", "put hello world", OK, ["hello world", "hello"]);
  test("", "put hello world;", OK, ["hello world", ""]);

  test("", "def a 13; put $a;", OK, ["13", ""]);
  test("", "def a 13; unset a; put $a;", OK, ["", ""]);

  test("", "set a 13; put $a", OK, ["13", "13"]);
  test("", "set a 13; put $a;", OK, ["13", ""]);
  test("", "set a 13; unset a; put $a;", OK, ["", ""]);

  test("", "set a 13; put [get a]", OK, ["13", "13"]);
  test("", "set a 13; put [get a];", OK, ["13", ""]);
  test("", "set a 13; unset a; put [get a];", OK, ["", ""]);

  test("", "set a b; set b 18; get [get a]", OK, ["18"]);
  test("", "set a b; set b 18; get $a", OK, ["18"]);

  test("", "+ 1 2", OK, ["3"]);
  test("", "+ 1 [- 8 2]", OK, ["7"]);
  test("", "+ 1 [- 8 [* 13 2]]", OK, ["-17"]);
  test("", "/ 1 2", OK, ["0.5"]);
  test("", "/ 1 0.5", OK, ["2"]);
  test("", "/ 10 0", ERR, ["cmd / expected valid numbers"]);

  test("", "set a {1 2 3}", OK, ["1 2 3"]);
  test("", "set a {1 2 3}; a", ERR, ["cmd 1 not found"]);
  test("", "set a {get a}; a", OK, ["get a"]);

  test("", "set a {get args.v._size}; a one two three", OK, ["3"]);
  test("", "set a {get args.v._size;}; a one two three", OK, [""]);
  test("", "set a {get args.kv._size}; a one two three", OK, ["0"]);
  test("", "set a {get args.kv._size}; a one two -foo three -bar four", OK, ["2"]);
  test("", "set a {copy k args.kv; get k._size}; a one two -foo three -bar four", OK, ["2"]);
  test("", "set a {copy k args.kv; + [get k.-bar] [get k.-foo]}; a 1 2 -foo 3 -bar 4", OK, ["7"]);

  test("", "assert {= 1 1}", OK, [""]);
  test("", "assert {= 1 2}", ERR, ["FAILED ASSERT: = 1 2"]);

  test("", "def a foo; def b.$a bar; get b.foo", OK, ["bar"]);
  test("", "def a foo; def b.foo bar; get b.$a", OK, ["bar"]);

  console.log = log;
}

tests();

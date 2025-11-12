const OK = 0;
const BREAK = 1;
const CONTINUE = 2;
const RETURN = 3;
const ERR = 4;
const PANIC = 5;

const IS_PROC = 1 << 0;
const IS_SUBCOMMAND = 1 << 1;
const IS_BLOCK = 1 << 2;

let print_buffer = [];
let log = console.log;

const L = (arg, msg) => (log({ L: arg, ...(msg ? { msg } : {}) }), arg);
const N = Number;
const U = undefined;

function lookup(X, name) {
  // log({ wtf: 1, X, name });
  while (X) {
    // if (name === "a") log({ X, name });
    if (X.has(name)) return [X.get(name), X];
    X = X.parent;
  }
  return [U, U];
}

function get(X, args) {
  let fst = args[0];
  let value = lookup(X, fst)[0];
  let i = 1;
  while (i < args.length) {
    if (typeof value === "string" || Array.isArray(value)) value = value[args[i]];
    if (value instanceof Map) value = value.get(args[i]);
    if (typeof value === "number") return [ERR, "numbers do not support key lookups"];
    if (typeof value === "function") return [ERR, "builtins do not support key lookups"];
    i++;
  }
  if (typeof value === "function") return [OK, "<builtin>"];
  return [OK, value];
}

function set(X, name, value) {
  // log({ name, value: typeof value });
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

function def_args(X, args) {
  let positional_only = false;
  let argv = [];
  let argkv = new Map();
  for (let i = 0; i < args.length; i++) {
    let arg = args[i];
    if (arg === "--") positional_only = true;
    else if (typeof arg === "string" && arg.startsWith("-") && !positional_only) argkv.set(to_string(arg), args[++i]);
    else argv.push(arg);
  }
  X.set("argv", argv);
  X.set("argkv", argkv);
}

function register_builtin(X, cmd, arg_count, func) {
  X.set(cmd, (X2, args) => {
    if (Array.isArray(arg_count)) {
      if (args.length < arg_count[0]) return [ERR, `cmd ${cmd} expected at least ${arg_count[0]} arguments`];
      if (args.length > arg_count[1]) return [ERR, `cmd ${cmd} expected at most ${arg_count[1]} arguments`];
    } else if (arg_count !== -1 && args.length !== arg_count)
      return [ERR, `cmd ${cmd} expected ${arg_count} arguments`];
    return func(args, X2, cmd, arg_count);
  });
}

function to_num(cmd, value) {
  if (Number.isFinite(value)) return [OK, value + ""];
  return [ERR, `cmd ${cmd} expected valid numbers`];
}

function get_comparison_op(func) {
  return (args, _X, cmd) => {
    let fst = N(args[0]);
    let snd = N(args[1]);
    if (!(N.isFinite(fst) && N.isFinite(snd))) return [ERR, `cmd ${cmd} expected valid numbers`];
    return [OK, func(fst, snd) ? "1" : "0"];
  };
}

function register_num_comparison_op(X, cmd, func) {
  register_builtin(X, cmd, 2, get_comparison_op(func));
}

function register_all_builtins(X) {
  let rb = register_builtin;
  rb(X, "def", [2, 1000], ([lhs, rhs], X) => (X.set(lhs, rhs), [OK, rhs]));
  rb(X, "get", [1, 1000], (args, X) => get(X, args));
  rb(X, "set", [2, 1000], ([lhs, rhs], X) => (set(X, lhs, rhs), [OK, rhs]));
  rb(X, "unset", [1, 1000], ([name], X) => (unset(X, name), [OK, undefined]));
  rb(X, "proc", 2, ([name, code], X) => {
    X.set(name, code);
    return [OK, U];
  });

  rb(X, "id", 1, ([name]) => [OK, name]);
  rb(X, "put", -1, (args) => (console.log(args.map((arg) => to_string(arg)).join(" ")), [OK, args[0]]));

  rb(X, "+", 2, (args, _, cmd) => to_num(cmd, N(args[0]) + N(args[1])));
  rb(X, "-", 2, (args, _, cmd) => to_num(cmd, N(args[0]) - N(args[1])));
  rb(X, "*", 2, (args, _, cmd) => to_num(cmd, N(args[0]) * N(args[1])));
  rb(X, "/", 2, (args, _, cmd) => to_num(cmd, N(args[0]) / N(args[1])));

  let rnco = register_num_comparison_op;
  rnco(X, "=", (a, b) => a === b);
  rnco(X, "!=", (a, b) => a !== b);
  rnco(X, "<", (a, b) => a < b);
  rnco(X, ">", (a, b) => a > b);
  rnco(X, "<=", (a, b) => a <= b);
  rnco(X, ">=", (a, b) => a >= b);

  rb(X, "=str", 2, ([a, b]) => (a === b ? "1" : "0"));
  rb(X, "!=str", 2, ([a, b]) => (a !== b ? "1" : "0"));
  rb(X, "<str", 2, ([a, b]) => (a < b ? "1" : "0"));
  rb(X, ">str", 2, ([a, b]) => (a > b ? "1" : "0"));
  rb(X, "<=str", 2, ([a, b]) => (a <= b ? "1" : "0"));
  rb(X, ">=str", 2, ([a, b]) => (a >= b ? "1" : "0"));

  rb(X, "size", 1, ([value], X, cmd) => {
    if (typeof value === "string") return [OK, value.length];
    if (Array.isArray(value)) return [OK, value.length];
    if (value instanceof Map) return [OK, value.size];
    return [ERR, `cmd ${cmd} expected a string or list or table`];
  });

  rb(X, "append", -1, (args) => [OK, args?.join("")]);
  rb(X, "split", 3, ([sep, str]) => [OK, str.split(sep)]);
  rb(X, "at", 2, ([i, str]) => [OK, str[i]]);
  rb(X, "slice", 3, ([start, end, str], _X, cmd) => {
    if (!(N.isFinite(N(start)) && N.isFinite(N(end)))) return [ERR, `cmd ${cmd} expected valid numbers`];
    return [OK, str.slice(start, end)];
  });

  rb(X, "push", 2, ([list, it], X, cmd) => {
    if (!Array.isArray(list)) return [ERR, `cmd ${cmd} expected a list`];
    list.push(it);
    return [OK, ""];
  });
  rb(X, "pop", 1, ([list], X, cmd) => {
    if (!Array.isArray(list)) return [ERR, `cmd ${cmd} expected a list`];
    return [OK, list.pop() ?? ""];
  });
  rb(X, "concat", -1, (args, X, cmd) => {
    if (args.length < 2) return [ERR, `cmd ${cmd} expected at least 2 arguments`];
    if (args.some((arg) => !Array.isArray(arg))) return [ERR, `cmd ${cmd} expected lists`];
    return [OK, args.flat()];
  });
  rb(X, "join", 2, ([sep, list], X, cmd) => {
    if (!Array.isArray(list)) return [ERR, `cmd ${cmd} expected a list`];
    return [OK, list.join(sep)];
  });

  rb(X, "list", -1, (args) => [OK, args]);
  let cmd_to_list = ([code], X) => {
    let values = interpret_value_list(X, code, 0);
    if (status !== OK) return [ERR, values];
    if (!Array.isArray(values)) return [ERR, `Failed to build list`];
    return [OK, values];
  };
  rb(X, "to-list", 1, cmd_to_list);

  let cmd_table = (args, X, cmd) => {
    if (args.length % 2 !== 0) return [ERR, `cmd ${cmd} expected even number of arguments`];
    let table = new Map();
    for (let i = 0; i < args.length; i += 2) table.set(args[i], args[i + 1]);
    return [OK, table];
  };
  rb(X, "table", -1, cmd_table);
  rb(X, "to-table", 1, (args, X, cmd) => {
    let [status, list] = cmd_to_list(args, X);
    if (status !== OK) return [ERR, `Failed to build table`];
    return cmd_table(list, X, cmd);
  });

  rb(X, "delete", 1, ([obj], X) => {
    [...X.entries()].forEach(([key]) => (key.startsWith(obj + ".") ? X.delete(key) : undefined));
    return [OK, U];
  });

  rb(X, "with", 2, ([table, src], X, cmd) => {
    if (!(table instanceof Map)) return [ERR, `cmd ${cmd} expected a table`];
    return interpret_cmd(table, src, 0)[1];
  });

  rb(X, "break", [0, 1], ([n]) => {
    if (n !== undefined && (!N.isInteger(N(n)) || N(n) < 1)) return [ERR, `cmd break expected an integer`];
    return [BREAK, n];
  });
  rb(X, "continue", [0, 1], ([n]) => {
    if (n !== undefined && (!N.isInteger(N(n)) || N(n) < 1)) return [ERR, `cmd break expected an integer`];
    return [CONTINUE, n];
  });
  rb(X, "return", [0, 1], ([value]) => [RETURN, value]);

  rb(X, "assert", [1, 2], ([cond, msg], X) => {
    if ((result = interpret_cmd(X, cond, 0)[1])[0] !== OK) return result;
    msg = msg === undefined ? `FAILED ASSERT: { ${cond} }` : msg;
    return !result[1] || result[1] === "0" ? [ERR, msg] : [OK, undefined];
  });

  rb(X, "try", 2, ([code, catch2], X) => {
    try {
      let result = interpret_cmd(X, code, 0)[1];
      if (result[0] === ERR) {
        X.set("error", result[1]);
        return interpret_cmd(X, catch2, 0)[1];
      }
      return result;
    } catch (e) {
      X.set("error", e.message);
      return interpret_cmd(X, catch2, 0)[1];
    }
  });

  function handle_result_in_loop(result) {
    let [status, value] = result;
    if (status === ERR || status === RETURN) return result;
    if (status === BREAK && N(value) > 1) return [BREAK, N(value) - 1 + ""];
    if (status === BREAK) return [OK, U];
    if (status === CONTINUE && N(value) > 1) return [CONTINUE, N(value) - 1 + ""];
  }

  rb(X, "if", -1, (args, X, cmd) => {
    if (args.length < 2) return [ERR, `cmd ${cmd} expected at least 2 arguments`];
    args = [cmd].concat(args);
    // syntax check
    for (let i = 1; i < args.length; i++) {
      if (i % 3 === 0) {
        if (args[i] === "elif") continue;
        if (args[i] === "else") {
          if (i !== args.length - 2) return [ERR, `cmd ${cmd} expected else to be the penultimate argument`];
          if (typeof args[i + 1] !== "string") return [ERR, `cmd ${cmd} arg ${i} expected a string`];
          continue;
        }
        // log({ arg: args[i], i });
        return [ERR, `cmd ${cmd} expected arg ${i} to be elif or else`];
      } else {
        if (typeof args[i] !== "string") return [ERR, `cmd ${cmd} arg ${i} expected a string`];
      }
    }
    // run
    let i = 1;
    while (i < args.length) {
      if ((result = interpret_cmd(X, args[i], 0)[1])[0] !== OK) return result;
      if (!result[1] || result[1] === "0") {
        if (args[i + 2] === "else") return interpret_cmd(X, args[i + 3], 0)[1];
        else i += 3;
      } else return interpret_cmd(X, args[i + 1], 0)[1];
    }
    return [OK, U];
  });

  rb(X, "while", 2, ([cond, code], X, cmd) => {
    let iter = 1_0;
    while (true) {
      if (iter-- < 0) return [ERR, `max iterations exceeded in ${cmd} loop`];
      if ((result = interpret_cmd(X, cond, 0)[1])[0] !== OK) return result;
      if (!result[1] || result[1] === "0") break;
      result = handle_result_in_loop(interpret_cmd(X, code, 0)[1]);
      if (result) return result;
    }
    return [OK, U];
  });

  rb(X, "for", 4, ([setup, cond, end, code], X) => {
    if ((result = interpret_cmd(X, setup, 0))[0] !== OK) return result;
    let iter = 1_000;
    while (true) {
      if (iter-- < 0) return [ERR, `max iterations exceeded in ${cmd} loop`];
      if ((result = interpret_cmd(X, cond, 0))[0] !== OK) return result;
      if (!result[1] || result[1] === "0") break;
      result = handle_result_in_loop(interpret_cmd(X, code, 0)[1]);
      if (result) return result;
      result = interpret_cmd(X, end, 0)[1];
      if (result[0] === ERR || result[0] === RETURN) return result;
      if ((result = interpret_cmd(X, setup, 0))[0] !== OK) return result;
    }
    return [OK, U];
  });

  rb(X, "each", 2, ([coll, code], X, cmd) => {
    let is_table = coll instanceof Map;
    if (!(coll instanceof Map || Array.isArray(coll))) return [ERR, `cmd ${cmd} expected a list or table`];
    let items = Array.isArray(coll) ? coll : Array.from(coll.entries());
    for (let i = 0; i < items.length; i++) {
      let item = items[i];
      if (is_table) X.set("key", item[0]), X.set("it", item[1]), X.set("i", i);
      else X.set("it", item), X.set("i", i);
      result = handle_result_in_loop(interpret_cmd(X, code, 0)[1]);
      if (result) return result;
    }
    return [OK, U];
  });
}

function run_cmd(X, name, args) {
  let [impl] = lookup(X, name);
  // log("run_cmd", { name, args, impl });
  if (!impl) return [ERR, `cmd ${name} not found`];
  if (typeof impl === "function") return impl(X, args);
  let X2 = new Map();
  // log({ static_X_parent: static_X.parent, static_X, name });
  X2.parent = X;
  def_args(X2, args);
  let res = interpret_cmd(X2, impl, 0)[1];
  let [status, value] = res;
  if (status === RETURN) return [OK, value];
  else if (status === BREAK) return [ERR, "break may not be used to break out of a procedure"];
  else if (status === CONTINUE) return [ERR, "continue may not be used to break out of a procedure"];
  else return [status, value];
}

function parse_string(src, i) {
  let c;
  let len = src.length;
  let char_arr = [];
  while (i < len && !" \t\n;[]{}$\\".includes((c = src[i]))) {
    if (c === "\\") {
      c = src[++i];
      if (i >= len) return [len, [ERR, "Unexpected end of source"]];
    }
    char_arr.push(c);
    i++;
  }
  return [i, char_arr.join("")];
}

function encode_string(str) {
  return /[\[\{" \n\t]/g.test(str) ? '"' + str.replace(/"/g, '"') + '"' : str;
}

function to_string(it) {
  if (it === U || it === undefined) return "";
  if (typeof it === "string") return it;
  if (typeof it === "number") return it + "";
  if (typeof it === "function") return "<builtin>"; // TODO : get the name
  if (it instanceof Map) {
    let entries = Array.from(it.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    let str = entries.map(([key, value]) => to_string(key) + " " + to_string(value)).join(" ");
    return str ? `[table ${str}]` : "[table]";
  }
  if (Array.isArray(it)) {
    let str = it.map(to_string).join(" ");
    return str ? `[list ${str}]` : "[list]";
  }
  throw Error(`Unknown type of ${it}`);
}

function next_item(X, src, i) {
  // log({ src, i });
  let item = (value = U);
  let status = 0;
  let str = "";
  let len = src.length;
  let iter = 100;
  let char_arr = [];
  while (true) {
    if (iter-- <= 0) return [i, [ERR, "max iterations exceeded in interpreter"]];
    let c = src[i];
    if (i >= len || " \t\n;#]".includes(c)) return [i, [OK, item]];
    else if (c === "}") return [i, [ERR, "Unexpected }"]];
    else if (c === "{") {
      let string_start = ++i;
      let count = 1;
      while ((c = src[i])) {
        if (c === "{") count++;
        if (c === "}") count--;
        if (count === 0) break;
        if (i >= len) return [len, [ERR, "Unexpected end of source"]];
        if (c === '"') while ((c = src[++i]) !== '"') if (c === "\\") i++;
        i++;
      }
      item = to_string(item) + src.slice(string_start, i++);
    } else if (c === "[") {
      let res = interpret_cmd(X, src, i + 1, IS_SUBCOMMAND);
      [i, [status, value]] = res;
      if (status !== OK) return res;
      item === U ? (item = value) : (item = to_string(item) + to_string(value));
    } else if (c === '"') {
      char_arr = [];
      while ((c = src[++i]) !== '"') {
        if (c === "\\") c = src[++i];
        if (i >= len) return [len, [ERR, "Unexpected end of source"]];
        char_arr.push(c);
      }
      item = to_string(item) + char_arr.join("");
      i++;
    } else if (c === "$") {
      [i, str] = parse_string(src, i + 1);
      [status, value] = get(X, [str]);
      if (status !== OK) return [i, [status, value]];
      item === U ? (item = value) : (item = to_string(item) + to_string(value));
    } else {
      [i, str] = parse_string(src, i);
      item === U ? (item = str) : (item = to_string(item) + str);
    }
  }
}

function interpret_value_list(X, src, i) {
  let values = [];
  let len = src.length;
  let iter = 100;
  while (i < len) {
    if (iter-- <= 0) return [i, [ERR, "max iterations exceeded in interpreter"]];
    let c = src[i];
    if (" \t\n".includes(c)) i++;
    else if (";]}".includes(c)) return [i, [ERR, "Unexpected " + c]];
    else {
      [i, [status, item]] = next_item(X, src, i);
      if (status !== OK) return [i, [status, item]];
      if (item !== U) values.push(item);
    }
  }
  return values;
}

function interpret_cmd(X, src, i, opt = 0) {
  // log({ src, i, opt, X });
  let cmd = (str = "");
  let item = U;
  let args = [];
  let last_value = [OK, ""];
  let len = src.length;
  let iter = 100;
  while (true) {
    if (iter-- <= 0) return [i, [ERR, "max iterations exceeded in interpreter"]];
    let c = src[i];
    if (i >= len || c === "\n" || c === ";") {
      if (item !== U && cmd) args.push(item), (item = U);
      else if (item !== U && !cmd) (cmd = item), (item = U);
      if (cmd) {
        last_value = run_cmd(X, cmd, args);
        if (last_value[0] !== OK) return [i, last_value];
      }
      (cmd = ""), (args.length = 0);
      if (c === ";" && last_value[0] === OK) last_value = [OK, ""];
      if (i >= len) return [i, last_value];
      i++;
    } else if (c === " " || c === "\t") {
      if (item !== U && cmd) args.push(item);
      else if (item !== U && !cmd) cmd = item;
      item = U;
      i++;
    } else if (c === "]") {
      if (!(opt & IS_SUBCOMMAND)) return [i, [ERR, "Unexpected ]"]];
      if (item !== U && cmd) args.push(item), (item = U);
      else if (item !== U && !cmd) (cmd = item), (item = U);
      if (cmd) {
        last_value = run_cmd(X, cmd, args);
        if (last_value[0] !== OK) return [i, last_value];
      } else last_value = [OK, ""];
      return [i + 1, last_value];
    } else if (c === "#") {
      while (i < len && !"\n;".includes(src[i])) i++;
    } else {
      [i, [status, item]] = next_item(X, src, i);
      if (status !== OK) return [i, [status, item]];
    }
  }
}

function eval(src) {
  let X = new Map();
  register_all_builtins(X);
  try {
    let [_i, [status, value]] = interpret_cmd(X, src, 0);
    return [status, to_string(value)];
  } catch (e) {
    return [PANIC, "PANIC: " + e.message];
  }
}

let test_failures = 0;

function test(name, src, code, values) {
  print_buffer.length = 0;
  // log("TEST:", name || src);
  let [result_code, result_value] = eval(src);
  let all_equal = values.length === print_buffer.length + 1;
  for (let i = 0; i < print_buffer.length; i++) {
    if (all_equal === false) break;
    if (print_buffer[i] !== values[i]) all_equal = false;
  }
  if (result_code === code && result_value === values.at(-1) && all_equal) {
    log("PASS:", name || src);
  } else {
    test_failures++;
    log("FAIL:", name || src);
    log("EXPECTED:", values);
    log("ACTUAL:", [...print_buffer, result_value]);
  }
  print_buffer.length = 0;
}

function tests() {
  test_failures = 0;
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
  test("", "proc a {1 2 3}", OK, [""]);
  test("", "proc a {1 2 3}; a", ERR, ["cmd 1 not found"]);
  test("", "proc a {get a}; a", OK, ["get a"]);

  test("", "proc a {size $argv}; a one two three", OK, ["3"]);
  test("", "proc a {size $argv;}; a one two three", OK, [""]);
  test("", "proc a {size $argkv}; a one two three", OK, ["0"]);
  test("", "proc a {size $argkv}; a one two -foo three -bar four", OK, ["2"]);
  test("", "proc a {get argv 1}; a one two three", OK, ["two"]);
  test("", "proc a {get argkv -foo}; a one two -foo three -bar four", OK, ["three"]);
  test("", "proc a {get argkv -foo bar}; a one two -foo [table bar 4]", OK, ["4"]);

  test("", "assert {= 1 1}", OK, [""]);
  test("", "assert {= 1 2}", ERR, ["FAILED ASSERT: { = 1 2 }"]);

  test("", "try {assert {= 1 1}} {id $error}", OK, [""]);
  test("", "try {assert {= 1 2}} {id $error}", OK, ["FAILED ASSERT: { = 1 2 }"]);

  test("", "def a foo; def b.$a bar; get b.foo", OK, ["bar"]);
  test("", "def a foo; def b.foo bar; get b.$a", OK, ["bar"]);
  test("", "def a foo; def b.[get a] bar; get b.foo", OK, ["bar"]);
  test("", "def a foo; def b.foo bar; get b.[get a]", OK, ["bar"]);
  test("", "def a.[id foo] bar; get a.foo", OK, ["bar"]);
  test("", "def a.foo bar; get a.[id foo]", OK, ["bar"]);

  test("", `proc a {set b "foo bar"; get b}; a`, OK, ["foo bar"]);

  test("", `def a [table]; size $a`, OK, ["0"]);
  test("", `def a [table a b c d]; get a a`, OK, ["b"]);
  test("", `def a [table a b c d]; get a b`, OK, [""]);
  test("", `def a [table a b c d]; get a c`, OK, ["d"]);
  test("", `def a [table a b c d]; get a e f g`, OK, [""]);
  test("", `def a [table a b c d]; get a`, OK, ["[table a b c d]"]);
  test("", `def a [table a b]; def b $a; get b`, OK, ["[table a b]"]);
  test("", `def a [table a b c d]; size $a`, OK, ["2"]);
  test("", `def a [table b [table c [table d 3]]]; get a b c d`, OK, ["3"]);

  test("", `def a [list]; size $a`, OK, ["0"]);
  test("", `def a [list a b c d]; size $a`, OK, ["4"]);
  test("", `def a [list a b c d]; get a 0`, OK, ["a"]);
  test("", `def a [list a b c d]; get a 3`, OK, ["d"]);
  test("", `def a [list a [list 5 6 7] c d]; get a 1 2`, OK, ["7"]);

  test("", `to-list {1 2 3}`, OK, ["[list 1 2 3]"]);
  test("", `to-table {a b c d}`, OK, ["[table a b c d]"]);
  test("", `to-table {a [ table ] c [list]}`, OK, ["[table a [table] c [list]]"]);

  test("", `def a 4; def b [join " " [concat [list get] [list a]]]; b`, OK, ["4"]);

  test(
    "each table",
    `
    def a [table a 1 b 2]
    each $a {put $key $it $i}
    `,
    OK,
    ["a 1 0", "b 2 1", ""],
  );

  test("", `def a 0; while {< $a 5} {put $a; set a [+ $a 1];}`, OK, ["0", "1", "2", "3", "4", ""]);

  test("", `proc a {return 1; return 2}; a`, OK, ["1"]);

  test("", `while {< 1 2} {put 3; break}`, OK, ["3", ""]);
  test("", `while {id 1} {break 1}`, OK, [""]);
  test("", `while {id 1} {put 3; while {id 1} {put 4; break 2}; put 5}`, OK, ["3", "4", ""]);

  test("", `proc add {+ [get argv 0] [get argv 1]}; add 1 2`, OK, ["3"]);

  test("", `def a [if {id 0} {put 1} elif {id ""} {put 2} elif {id 1} {put 3} else {put 4}]; get a`, OK, ["3", "3"]);
  test("", `def a [if {id 0} {put 1} elif {id ""} {put 2} elif {id 0} {put 3} else {put 4}]; get a`, OK, ["4", "4"]);

  test("", `def a 1 # anything can go here`, OK, ["1"]);
  test(
    "comments",
    `
    def a 1           # anything can go here
    set a "foo#bar"   # or here
    `,
    OK,
    ["foo#bar"],
  );

  test("stack overflow", `def a {a}; a`, PANIC, ["PANIC: Maximum call stack size exceeded"]);
  test("stack overflow", `try {def a {a}; a} {put $error;}`, OK, ["Maximum call stack size exceeded", ""]);

  test("", `def a 2; proc b {return $a}; b`, OK, ["2"]);
  test("", `def a 2; proc b {return [get a]}; b`, OK, ["2"]);

  // TODO
  /*
  test(
    "closure",
    `
    def a 1
    def b {
      def a 2
      return {return $a}
    }
    def c [b]
    c
    id $a
    `,
    OK,
    ["2", "1"],
  );
  */

  log(test_failures ? test_failures + " FAILURES" : "ALL TESTS PASSED");

  console.log = log;
}

tests();

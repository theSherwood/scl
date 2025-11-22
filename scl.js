// IMPLEMENTATION
////////////////////////////////////////////////////////////////////////////////

const OK = 0;
const BREAK = 1;
const CONTINUE = 2;
const RETURN = 3;
const ERR = 4;
const PANIC = 5;

const IS_SUBCOMMAND = 1 << 0;

let put_log = console.log;

const N = Number;
const U = undefined;
const NIL = "";
const GLOBAL = "global";
const STATIC_PARENT = "outer";
const DYN_PARENT = "dyn";

let is_str = (x) => typeof x === "string";
let is_num = (x) => x && is_str(x) && !N.isNaN(N(x));
let is_proc = (x) => x && x.is_proc;
let is_list = (x) => Array.isArray(x);
let is_table = (x) => x instanceof Map;
let is_builtin = (x) => typeof x === "function";
let is_cmd = (x) => is_builtin(x) || is_proc(x);
let is_int = (x) => is_num(x) && N.isInteger(N(x));
let is_float = (x) => is_num(x) && !N.isInteger(N(x));

let is_falsy = (x) => x === 0 || x === "0" || x === false || x === NIL || x === U;

function get(X, name, parent) {
  while (X) {
    if (X.has(name)) return [OK, X.get(name)];
    X = X.get(parent);
  }
  return [OK, NIL];
}
function set(X, name, value, parent) {
  while (X.has(parent)) {
    if (X.has(name)) break;
    X = X.get(parent);
  }
  X.set(name, value);
}
function unset(X, name, parent) {
  while (X) {
    if (X.has(name)) return X.delete(name);
    X = X.get(parent);
  }
}

function getin(value, args, i = 0) {
  while (i < args.length) {
    if (is_builtin(value) | is_proc(value)) return [ERR, "invalid collection"];
    else if (is_str(value) || is_list(value)) value = value[args[i]];
    else if (is_table(value)) value = value.get(args[i]);
    i++;
  }
  return [OK, value];
}
function setin(coll, args, i = 0) {
  while (i < args.length - 2) {
    if (is_list(coll)) coll = coll[args[i]];
    else if (is_table(coll)) coll = coll.get(args[i]);
    else return [ERR, "invalid collection"];
    i++;
  }
  if (!(is_table(coll) || is_list(coll))) return [ERR, "invalid collection"];
  if (is_list(coll) && !is_int(args[i])) return [ERR, "invalid index"];
  let value = args[args.length - 1];
  if (is_list(coll)) coll[args[i]] = value;
  else if (is_table(coll)) coll.set(args[i] + "", value);
  return [OK, value];
}
function unsetin(coll, args, i = 0) {
  while (i < args.length - 1) {
    if (is_list(coll)) coll = coll[args[i]];
    else if (is_table(coll)) coll = coll.get(args[i]);
    else return [ERR, "invalid collection"];
    i++;
  }
  if (!is_table(coll)) return [ERR, "invalid collection"];
  coll.delete(args[i] + "");
  return [OK, NIL];
}

function def_args(X, args) {
  let positional_only = false;
  let argv = [];
  let argkv = new Map();
  for (let i = 0; i < args.length; i++) {
    let arg = args[i];
    if (arg === "--") positional_only = true;
    else if (typeof arg === "string" && arg.startsWith("-") && !positional_only) argkv.set(to_str(arg), args[++i]);
    else argv.push(arg);
  }
  X.set("argv", argv);
  X.set("argkv", argkv);
}

function register_builtin(X, cmd, arg_count, func) {
  X.set(cmd, (X2, args) => {
    if (Array.isArray(arg_count)) {
      if (args.length < arg_count[0]) return [ERR, `cmd "${cmd}" expected at least ${arg_count[0]} arguments`];
      if (args.length > arg_count[1]) return [ERR, `cmd "${cmd}" expected at most ${arg_count[1]} arguments`];
    } else if (arg_count !== -1 && args.length !== arg_count)
      return [ERR, `cmd "${cmd}" expected ${arg_count} arguments`];
    return func(args, X2, cmd, arg_count);
  });
}

let to_num = (cmd, value) => (N.isFinite(value) ? [OK, value + ""] : [ERR, `cmd "${cmd}" expected valid numbers`]);

function get_comparison_op(func) {
  return (args, _X, cmd) => {
    if (!(is_num(args[0]) && is_num(args[1]))) return [ERR, `cmd "${cmd}" expected valid numbers`];
    return [OK, func(N(args[0]), N(args[1])) ? "1" : "0"];
  };
}

let register_num_comparison_op = (X, cmd, func) => register_builtin(X, cmd, 2, get_comparison_op(func));

function run_cmd(X, cmd, args) {
  let impl = is_str(cmd) ? get(X, cmd, STATIC_PARENT)[1] : cmd;
  if (!impl) return [ERR, `cmd "${to_str(cmd)}" not found`];
  let status, value;
  if (is_builtin(impl)) return ([status, value] = impl(X, args)), [status, value ?? NIL];
  if (!impl.is_proc) return [ERR, `${to_str(impl)} is not callable`];
  let X2 = new Map();
  X2.set(STATIC_PARENT, impl.X);
  X2.set(DYN_PARENT, X);
  X2.set(GLOBAL, impl.X.get(GLOBAL));
  def_args(X2, args);
  [status, value] = interpret_cmd(X2, impl.code, 0)[1];
  if (status === RETURN) return [OK, value ?? NIL];
  else if (status === BREAK) return [ERR, "attempting to BREAK out of a procedure"];
  else if (status === CONTINUE) return [ERR, "attempting to CONTINUE out of a procedure"];
  else return [status, value ?? NIL];
}

function parse_string(src, i, regex) {
  let c;
  let len = src.length;
  let char_arr = [];
  while (i < len && regex.test((c = src[i]))) {
    if (i >= len) return [len, [ERR, "Unexpected end of source"]];
    char_arr.push(c), i++;
  }
  return [i, char_arr.join("")];
}

function to_str(it) {
  let str;
  if (typeof it === "number") return it + "";
  if (it === U) return "";
  if (is_str(it)) return it;
  if (is_builtin(it)) return "<builtin>";
  if (is_list(it)) return (str = it.map(to_str).join(" ")) ? `[list ${str}]` : "[list]";
  if (is_proc(it)) return `[proc ${it.name ? it.name + " " : ""}{${it.code}}]`;
  if (is_table(it)) {
    let entries = Array.from(it.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return (str = entries.map(([k, v]) => to_str(k) + " " + to_str(v)).join(" ")) ? `[table ${str}]` : "[table]";
  }
  throw Error(`Unknown type of ${it}`);
}

function next_item(X, src, i) {
  let c, item, value, status, str, str_start, count, char_arr;
  let len = src.length;
  let iter = 1000;
  while (true) {
    if (iter-- <= 0) return [i, [ERR, "max iterations exceeded in interpreter"]];
    c = src[i];
    if (i >= len || " \t\n;#]".includes(c)) return [i, [OK, item]];
    else if (c === "}") return [i, [ERR, "Unexpected }"]];
    else if (c === "{") {
      (str_start = ++i), (count = 1);
      while ((c = src[i])) {
        if (c === "{") count++;
        if (c === "}") count--;
        if (count === 0) break;
        if (i >= len) return [len, [ERR, "Unexpected end of source"]];
        if (c === '"') while ((c = src[++i]) !== '"') if (c === "\\") i++;
        i++;
      }
      item = to_str(item) + src.slice(str_start, i++);
    } else if (c === "[") {
      [i, [status, value]] = interpret_cmd(X, src, i + 1, IS_SUBCOMMAND);
      if (status !== OK) return [i, [status, value]];
      item === U ? (item = value) : (item = to_str(item) + to_str(value));
    } else if (c === '"') {
      char_arr = [];
      while ((c = src[++i]) !== '"') {
        if (i >= len) return [len, [ERR, "Unexpected end of source"]];
        else if (c === "\\") {
          c = src[++i];
          if (i >= len) return [len, [ERR, "Unexpected end of source"]];
          char_arr.push(c === "n" ? "\n" : c === "t" ? "\t" : c);
          continue;
        } else if (c === "$") {
          if (src[i + 1] === "[") {
            [i, [status, value]] = interpret_cmd(X, src, i + 2, IS_SUBCOMMAND);
            if (status !== OK) return [i, [status, value]];
          } else {
            [i, str] = parse_string(src, i + 1, /[0-9A-Za-z_]/);
            [status, value] = get(X, str, STATIC_PARENT);
            if (status !== OK) return [i, [status, value]];
          }
          i--, char_arr.push(to_str(value));
          continue;
        } else char_arr.push(c);
      }
      item = to_str(item) + char_arr.join("");
      i++;
    } else if (c === "$") {
      [i, str] = parse_string(src, i + 1, /[0-9A-Za-z_]/);
      [status, value] = get(X, str, STATIC_PARENT);
      if (status !== OK) return [i, [status, value]];
      item === U ? (item = value) : (item = to_str(item) + to_str(value));
    } else {
      [i, str] = parse_string(src, i, /[^ \t\n;\[\]\{\}$\\]/);
      item === U ? (item = str) : (item = to_str(item) + str);
    }
  }
}

function interpret_value_list(X, src, i, values = [], iter = 10_000) {
  let c, status, item;
  while (i < src.length) {
    if (iter-- <= 0) return [i, [ERR, "max iterations exceeded in interpreter"]];
    c = src[i];
    if (" \t\n".includes(c)) i++;
    else if (c === "\\" && src[i + 1] === "\n") i += 2;
    else if (";]}".includes(c)) return [i, [ERR, "Unexpected " + c]];
    else {
      [i, [status, item]] = next_item(X, src, i);
      if (status !== OK) return [i, [status, item]];
      if (item !== U) values.push(item);
    }
  }
  return [i, [OK, values]];
}

function interpret_cmd(X, src, i, opt = 0, iter = 10_000) {
  let c, cmd, item, status;
  let args = [];
  let last_value = [OK, NIL];
  while (true) {
    if (iter-- <= 0) return [i, [ERR, "max iterations exceeded in interpreter"]];
    c = src[i];
    if (c === "\\" && src[i + 1] === "\n") i += 2;
    else if (i >= src.length || c === "\n" || c === ";") {
      if (item !== U && cmd) args.push(item), (item = U);
      else if (item !== U && !cmd) (cmd = item), (item = U);
      if (cmd) {
        last_value = run_cmd(X, cmd, [...args]);
        if (last_value[0] !== OK) return [i, last_value];
      }
      (cmd = ""), (args.length = 0);
      if (c === ";" && last_value[0] === OK) last_value = [OK, NIL];
      if (i >= src.length) return [i, last_value];
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
        last_value = run_cmd(X, cmd, [...args]);
        if (last_value[0] !== OK) return [i, last_value];
      }
      return [i + 1, last_value];
    } else if (c === "#") {
      while (i < src.length && !"\n;".includes(src[i])) i++;
    } else {
      [i, [status, item]] = next_item(X, src, i);
      if (status !== OK) return [i, [status, item]];
    }
  }
}

function register_all_builtins(X) {
  let rb = register_builtin;
  rb(X, "register-builtins", 1, ([table], X, cmd) => {
    if (!table instanceof Map) return [ERR, `cmd "${cmd}" expected a table`];
    register_all_builtins(table);
    return [OK, NIL];
  });

  rb(X, "def", [2, 1000], ([lhs, rhs], X) => (X.set(lhs, rhs), [OK, rhs]));

  rb(X, "get", 1, ([name], X) => get(X, name, STATIC_PARENT));
  rb(X, "set", 2, ([name, value], X) => (set(X, name, value, STATIC_PARENT), [OK, value]));
  rb(X, "unset", 1, ([name], X) => (unset(X, name, STATIC_PARENT), [OK, NIL]));

  rb(X, "get!", 1, ([name], X) => get(X, name, DYN_PARENT));
  rb(X, "set!", 2, ([name, value], X) => (set(X, name, value, DYN_PARENT), [OK, value]));
  rb(X, "unset!", 1, ([name], X) => (unset(X, name, DYN_PARENT), [OK, NIL]));

  rb(X, "getin", [1, 1000], (args) => getin(args[0], args, 1));
  rb(X, "setin", [1, 1000], (args) => setin(args[0], args, 1));
  rb(X, "unsetin", [1, 1000], (args) => unsetin(args[0], args, 1));

  rb(X, "proc", [1, 2], ([name, code], X) => {
    if (code === U) (code = name), (name = U);
    let proc = { name, code, X, is_proc: true };
    X.set(name, proc);
    return [OK, proc];
  });
  rb(X, "apply", 2, ([proc, list], X) => run_cmd(X, proc, list));
  rb(X, "src", 1, ([proc], X, cmd) => (is_proc(proc) ? [OK, proc.code] : [ERR, `cmd "${cmd}" expected a proc`]));

  rb(X, "id", 1, ([name]) => [OK, name]);
  rb(X, "put", -1, (args) => (put_log(args.map((arg) => to_str(arg)).join(" ")), [OK, args[0]]));

  rb(X, "+", 2, (args, _, cmd) => to_num(cmd, N(args[0]) + N(args[1])));
  rb(X, "-", 2, (args, _, cmd) => to_num(cmd, N(args[0]) - N(args[1])));
  rb(X, "*", 2, (args, _, cmd) => to_num(cmd, N(args[0]) * N(args[1])));
  rb(X, "/", 2, (args, _, cmd) => to_num(cmd, N(args[0]) / N(args[1])));
  rb(X, "%", 2, (args, _, cmd) => to_num(cmd, N(args[0]) % N(args[1])));
  rb(X, "**", 2, (args, _, cmd) => to_num(cmd, N(args[0]) ** N(args[1])));

  function map_value(X, name, cmd, parent, mapper) {
    let value = get(X, name, parent)[1];
    if (!is_int(value)) return [ERR, `cmd "${cmd}" expected an integer`];
    set(X, name, mapper(value), parent);
    return [OK, mapper(value)];
  }

  rb(X, "incr", 1, ([name], X, cmd) => map_value(X, name, cmd, STATIC_PARENT, (x) => N(x) + 1 + ""));
  rb(X, "decr", 1, ([name], X, cmd) => map_value(X, name, cmd, STATIC_PARENT, (x) => N(x) - 1 + ""));

  rb(X, "incr!", 1, ([name], X, cmd) => map_value(X, name, cmd, DYN_PARENT, (x) => N(x) + 1 + ""));
  rb(X, "decr!", 1, ([name], X, cmd) => map_value(X, name, cmd, DYN_PARENT, (x) => N(x) - 1 + ""));

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

  // These don't short-circuit
  rb(X, "or", [1, 1000], (args) => [OK, args.some((arg) => !is_falsy(arg)) ? "1" : "0"]);
  rb(X, "and", [1, 1000], (args) => [OK, args.every((arg) => !is_falsy(arg)) ? "1" : "0"]);
  rb(X, "not", 1, ([arg]) => [OK, is_falsy(arg) ? "1" : "0"]);

  rb(X, "num?", 1, ([value]) => [OK, is_num(value) ? "1" : "0"]);
  rb(X, "int?", 1, ([value]) => [OK, is_int(value) ? "1" : "0"]);
  rb(X, "str?", 1, ([value]) => [OK, is_str(value) ? "1" : "0"]);
  rb(X, "proc?", 1, ([value]) => [OK, is_proc(value) ? "1" : "0"]);
  rb(X, "list?", 1, ([value]) => [OK, is_list(value) ? "1" : "0"]);
  rb(X, "table?", 1, ([value]) => [OK, is_table(value) ? "1" : "0"]);
  rb(X, "builtin?", 1, ([value]) => [OK, is_builtin(value) ? "1" : "0"]);
  rb(X, "cmd?", 1, ([value]) => [OK, is_cmd(value) ? "1" : "0"]);

  rb(X, "size", 1, ([value], X, cmd) => {
    if (is_str(value) || is_list(value)) return [OK, value.length + ""];
    if (is_table(value)) return [OK, value.size + ""];
    return [ERR, `cmd "${cmd}" expected a string or list or table`];
  });

  rb(X, "str", -1, (args) => [OK, args?.map(to_str)?.join("") ?? ""]);
  rb(X, "split", 3, ([sep, str]) => [OK, str.split(sep)]);
  rb(X, "at", 2, ([i, str]) => [OK, str[i]]);
  rb(X, "slice", 3, ([str, start, end], _X, cmd) => {
    if (!(N.isFinite(N(start)) && N.isFinite(N(end)))) return [ERR, `cmd "${cmd}" expected valid numbers`];
    return [OK, str.slice(start, end)];
  });

  rb(X, "push", 2, ([list, it], X, cmd) => {
    if (!Array.isArray(list)) return [ERR, `cmd "${cmd}" expected a list`];
    return list.push(it), [OK, NIL];
  });
  rb(X, "pop", 1, ([list], X, cmd) => {
    if (!Array.isArray(list)) return [ERR, `cmd "${cmd}" expected a list`];
    return [OK, list.pop()];
  });
  rb(X, "concat", -1, (args, X, cmd) => {
    if (args.length < 2) return [ERR, `cmd "${cmd}" expected at least 2 arguments`];
    return args.some((arg) => !is_list(arg)) ? [ERR, `cmd "${cmd}" expected lists`] : [OK, args.flat()];
  });
  rb(X, "join", 2, ([sep, list], X, cmd) => {
    return !is_list(list) ? [ERR, `cmd "${cmd}" expected a list`] : [OK, list.join(to_str(sep))];
  });

  rb(X, "list", -1, (args) => [OK, args]);
  let cmd_to_list = ([code], X, cmd) => {
    if (!is_str(code)) return [ERR, `cmd "${cmd}" expected a string`];
    let [i, [status, values]] = interpret_value_list(X, code, 0);
    if (status !== OK) return [ERR, values];
    if (!is_list(values)) return [ERR, `Failed to build list`];
    return [OK, values];
  };
  rb(X, "to-list", 1, cmd_to_list);

  let cmd_table = (args, X, cmd) => {
    if (args.length % 2 !== 0) return [ERR, `cmd "${cmd}" expected even number of arguments`];
    let table = new Map();
    for (let i = 0; i < args.length; i += 2) table.set(args[i], args[i + 1]);
    return [OK, table];
  };
  rb(X, "table", -1, cmd_table);
  rb(X, "to-table", 1, (args, X, cmd) => {
    let [status, list] = cmd_to_list(args, X, cmd);
    return status === OK ? cmd_table(list, X, cmd) : [ERR, `Failed to build table`];
  });

  rb(X, "with", 2, ([table, src], X, cmd) => {
    return is_table(table) ? interpret_cmd(table, src, 0)[1] : [ERR, `cmd "${cmd}" expected a table`];
  });

  rb(X, "break", [0, 1], ([n], X, cmd) => {
    if (n !== undefined && (!is_int(n) || N(n) < 1)) return [ERR, `cmd "${cmd}" expected an integer > 0`];
    return [BREAK, n];
  });
  rb(X, "continue", [0, 1], ([n], X, cmd) => {
    if (n !== undefined && (!is_int(n) || N(n) < 1)) return [ERR, `cmd "${cmd}" expected an integer > 0`];
    return [CONTINUE, n];
  });
  rb(X, "return", [0, 1], ([value]) => [RETURN, value]);

  rb(X, "assert", [1, 2], ([cond, msg], X) => {
    let result;
    if ((result = interpret_cmd(X, cond, 0)[1])[0] !== OK) return result;
    msg = msg === undefined ? `FAILED ASSERT: { ${cond} }` : msg;
    return is_falsy(result[1]) ? [ERR, msg] : [OK, NIL];
  });

  rb(X, "raise", 1, ([msg]) => [ERR, to_str(msg)]);
  rb(X, "try", 2, ([code, catch2], X) => {
    let result;
    try {
      result = interpret_cmd(X, code, 0)[1];
    } catch (e) {
      result = [ERR, e.message];
    }
    if (result[0] === ERR) return X.set("error", result[1]), interpret_cmd(X, catch2, 0)[1];
    return result;
  });

  rb(X, "do", 1, ([code], X) => interpret_cmd(X, code, 0)[1]);

  rb(X, "if", -1, (args, X, cmd) => {
    if (args.length < 2) return [ERR, `cmd "${cmd}" expected at least 2 arguments`];
    args = [cmd].concat(args);
    // syntax check
    for (let i = 1; i < args.length; i++) {
      if (i % 3 === 0) {
        if (args[i] === "elif") continue;
        if (args[i] === "else") {
          if (i !== args.length - 2) return [ERR, `cmd "${cmd}" expected else to be the penultimate argument`];
          if (typeof args[i + 1] !== "string") return [ERR, `cmd "${cmd}" arg ${i} expected a string`];
          continue;
        }
        return [ERR, `cmd "${cmd}" expected arg ${i} to be elif or else`];
      } else {
        if (typeof args[i] !== "string") return [ERR, `cmd "${cmd}" arg ${i} expected a string`];
      }
    }
    // run
    let result;
    let i = 1;
    while (i < args.length) {
      if ((result = interpret_cmd(X, args[i], 0)[1])[0] !== OK) return result;
      if (!result[1] || result[1] === "0") {
        if (args[i + 2] === "else") return interpret_cmd(X, args[i + 3], 0)[1];
        else i += 3;
      } else return interpret_cmd(X, args[i + 1], 0)[1];
    }
    return [OK, NIL];
  });

  function handle_result_in_loop(result) {
    let [status, value] = result;
    if (status === ERR || status === RETURN) return result;
    if (status === BREAK && N(value) > 1) return [BREAK, N(value) - 1 + ""];
    if (status === BREAK) return [OK, NIL];
    if (status === CONTINUE && N(value) > 1) return [CONTINUE, N(value) - 1 + ""];
  }

  rb(X, "while", 2, ([cond, code], X, cmd) => {
    let result;
    let iter = 10_000;
    while (true) {
      if (iter-- < 0) return [ERR, `max iterations exceeded in "${cmd}" loop`];
      if ((result = interpret_cmd(X, cond, 0)[1])[0] !== OK) return result;
      if (!result[1] || result[1] === "0") break;
      result = handle_result_in_loop(interpret_cmd(X, code, 0)[1]);
      if (result) return result;
    }
    return [OK, NIL];
  });

  rb(X, "for", 4, ([setup, cond, end, code], X) => {
    let result;
    if ((result = interpret_cmd(X, setup, 0)[1])[0] !== OK) return result;
    let iter = 10_000;
    while (true) {
      if (iter-- < 0) return [ERR, `max iterations exceeded in "${cmd}" loop`];
      if ((result = interpret_cmd(X, cond, 0)[1])[0] !== OK) return result;
      if (!result[1] || result[1] === "0") break;
      result = handle_result_in_loop(interpret_cmd(X, code, 0)[1]);
      if (result) return result;
      if ((result = interpret_cmd(X, end, 0)[1])[0] !== OK) return result;
    }
    return [OK, NIL];
  });

  rb(X, "each", 2, ([coll, code], X, cmd) => {
    let result;
    let is_table = coll instanceof Map;
    if (!(coll instanceof Map || Array.isArray(coll))) return [ERR, `cmd "${cmd}" expected a list or table`];
    let items = Array.isArray(coll) ? coll : Array.from(coll.entries());
    for (let i = 0; i < items.length; i++) {
      let item = items[i];
      if (is_table) X.set("key", item[0]), X.set("it", item[1]), X.set("i", i);
      else X.set("it", item), X.set("i", i);
      result = handle_result_in_loop(interpret_cmd(X, code, 0)[1]);
      if (result) return result;
    }
    return [OK, NIL];
  });
}

function scl_eval(src) {
  let X = new Map();
  register_all_builtins(X);
  X.set(GLOBAL, X);
  try {
    let [_i, [status, value]] = interpret_cmd(X, src, 0);
    return [status, to_str(value)];
  } catch (e) {
    return [PANIC, "PANIC: " + e.message];
  }
}

// TESTS
////////////////////////////////////////////////////////////////////////////////

let test_failures = 0;
let print_buffer = [];

let examples = [];

function test(name, src, code, values) {
  if (name) examples.push({ name, src });
  print_buffer.length = 0;
  let [result_code, result_value] = scl_eval(src);
  let all_equal = values.length === print_buffer.length + 1;
  for (let i = 0; i < print_buffer.length; i++) {
    if (all_equal === false) break;
    if (print_buffer[i] !== values[i]) all_equal = false;
  }
  if (result_code === code && result_value === values.at(-1) && all_equal) {
    console.log("PASS:", name || src);
  } else {
    test_failures++;
    console.log("FAIL:", name || src);
    console.log("EXPECTED:", values);
    console.log("ACTUAL:", [...print_buffer, result_value]);
  }
  print_buffer.length = 0;
}

function tests() {
  test_failures = 0;
  // Send the console.logs from "put" to the buffer
  old_log = put_log;
  put_log = (...args) => print_buffer.push(...args);

  console.log("Start Tests");

  test("", "put hello world", OK, ["hello world", "hello"]);
  test("hello world", "put hello world;", OK, ["hello world", ""]);

  test("", "def a 13; put $a;", OK, ["13", ""]);
  test("", "def a 13; unset a; put $a;", OK, ["", ""]);

  test("", "set a 13; put $a", OK, ["13", "13"]);
  test("", "set a 13; put $a;", OK, ["13", ""]);
  test("set/unset 1", "set a 13; put $a; unset a; put $a;", OK, ["13", "", ""]);

  test("", "set a 13; put [get a]", OK, ["13", "13"]);
  test("", "set a 13; put [get a];", OK, ["13", ""]);
  test("set/unset 2", "set a 13; put $a; unset a; put [get a];", OK, ["13", "", ""]);

  test("", "set a b; set b 18; get [get a]", OK, ["18"]);
  test("", "set a b; set b 18; get $a", OK, ["18"]);

  test("", "+ 1 2", OK, ["3"]);
  test("", "+ 1 [- 8 2]", OK, ["7"]);
  test("", "+ 1 [- 8 [* 13 2]]", OK, ["-17"]);
  test("", "/ 1 2", OK, ["0.5"]);
  test("", "/ 1 0.5", OK, ["2"]);
  test("", "/ 10 0", ERR, ['cmd "/" expected valid numbers']);
  test("", "% 11 3", OK, ["2"]);
  test("", "% 11 16", OK, ["11"]);
  test("", "** 2 3", OK, ["8"]);

  test("incr", "def a 0; incr a; get a", OK, ["1"]);
  test("decr", "def a 0; decr a; get a", OK, ["-1"]);

  test("", "set a {1 2 3}", OK, ["1 2 3"]);
  test("", "proc a {1 2 3}", OK, ["[proc a {1 2 3}]"]);
  test("", "proc a {1 2 3}; a", ERR, ['cmd "1" not found']);
  test("", "proc a {get a}; a", OK, ["[proc a {get a}]"]);

  let quine_src_1 = `proc q {str [slice [str $q] 1 -1] "; put [q];" }; put [q];`;
  test("quine 1", quine_src_1, OK, [quine_src_1, ""]);
  let quine_src_2 = `def q {id "def q {$q}; do \\$q"}; do $q`;
  test("quine 2", quine_src_2, OK, [quine_src_2]);

  test("args 1", "proc a {size $argv}; a one two three", OK, ["3"]);
  test("args 2", "proc a {size $argv;}; a one two three", OK, [""]);
  test("args 3", "proc a {size $argkv}; a one two three", OK, ["0"]);
  test("args 4", "proc a {size $argkv}; a one two -foo three -bar four", OK, ["2"]);
  test("args 5", "proc a {getin $argv 1}; a one two three", OK, ["two"]);
  test("args 6", "proc a {getin $argkv -foo}; a one two -foo three -bar four", OK, ["three"]);
  test("args 7", "proc a {getin $argkv -foo bar}; a one two -foo [table bar 4]", OK, ["4"]);

  test("assert 1", "assert {= 1 1}", OK, [""]);
  test("assert 2", "assert {= 1 2}", ERR, ["FAILED ASSERT: { = 1 2 }"]);
  test("assert 3", "assert {= 1 2} {Not Equal}", ERR, ["Not Equal"]);

  test("try 1", "try {assert {= 1 1}} {id $error}", OK, [""]);
  test("try 2", "try {assert {= 1 2}} {id $error}", OK, ["FAILED ASSERT: { = 1 2 }"]);

  test("", "def a foo; def b.$a bar; get b.foo", OK, ["bar"]);
  test("", "def a foo; def b.foo bar; get b.$a", OK, ["bar"]);
  test("", "def a foo; def b.[get a] bar; get b.foo", OK, ["bar"]);
  test("", "def a foo; def b.foo bar; get b.[get a]", OK, ["bar"]);
  test("", "def a.[id foo] bar; get a.foo", OK, ["bar"]);
  test("", "def a.foo bar; get a.[id foo]", OK, ["bar"]);

  test("", `proc a {set b "foo bar"; get b}; a`, OK, ["foo bar"]);

  test("table 1", `def a [table]; size $a`, OK, ["0"]);
  test("table 2", `def a [table a b c d]; getin $a a`, OK, ["b"]);
  test("table 3", `def a [table a b c d]; getin $a b`, OK, [""]);
  test("table 4", `def a [table a b c d]; getin $a c`, OK, ["d"]);
  test("table 5", `def a [table a b c d]; getin $a e f g`, OK, [""]);
  test("table 6", `def a [table a b c d]; get a`, OK, ["[table a b c d]"]);
  test("table 7", `def a [table a b]; def b $a; get b`, OK, ["[table a b]"]);
  test("table 8", `def a [table a b c d]; size $a`, OK, ["2"]);
  test("table 9", `def a [table b [table c [table d 3]]]; getin $a b c d`, OK, ["3"]);

  test("list 1", `def a [list]; size $a`, OK, ["0"]);
  test("list 2", `def a [list a b c d]; size $a`, OK, ["4"]);
  test("list 3", `def a [list a b c d]; getin $a 0`, OK, ["a"]);
  test("list 4", `def a [list a b c d]; getin $a 3`, OK, ["d"]);
  test("list 5", `def a [list a [list 5 6 7] c d]; getin $a 1 2`, OK, ["7"]);

  test("", `to-list {1 2 3}`, OK, ["[list 1 2 3]"]);
  test("", `to-table {a b c d}`, OK, ["[table a b c d]"]);
  test("", `to-table {a [ table ] c [list]}`, OK, ["[table a [table] c [list]]"]);

  test("join", `def a 4; proc b [join " " [concat [list get] [list a]]]; b`, OK, ["4"]);

  test(
    "each table",
    `
def a [table a 1 b 2]
each $a {put $key $it $i}
`,
    OK,
    ["a 1 0", "b 2 1", ""],
  );

  test(
    "each list",
    `
def a [list 4 5 6]
each $a {put $it $i}
`,
    OK,
    ["4 0", "5 1", "6 2", ""],
  );

  test("while loop", `def a 0; while {< $a 5} {put $a; set a [+ $a 1];}`, OK, ["0", "1", "2", "3", "4", ""]);

  test("return", `proc a {return 1; return 2}; a`, OK, ["1"]);

  test("break 1", `while {< 1 2} {put 3; break}`, OK, ["3", ""]);
  test("break 2", `while {id 1} {break 1}`, OK, [""]);
  test("break 3", `while {id 1} {put 3; while {id 1} {put 4; break 2}; put 5}`, OK, ["3", "4", ""]);

  test("continue 1", `def a 0; while {< $a 3} {incr a; put 3; continue; put 4};`, OK, ["3", "3", "3", ""]);
  test("continue 2", `def a 0; while {< $a 3} {incr a; put 3; continue 1; put 4};`, OK, ["3", "3", "3", ""]);
  test("continue 3", `def a 0; while {< $a 3} {incr a; put 3; while {id 1} {continue 2}; put 4};`, OK, [
    "3",
    "3",
    "3",
    "",
  ]);

  test("getin", `proc add {+ [getin $argv 0] [getin $argv 1]}; add 1 2`, OK, ["3"]);

  test("if 1", `def a [if {id 0} {put 1} elif {id ""} {put 2} elif {id 1} {put 3} else {put 4}]; get a`, OK, [
    "3",
    "3",
  ]);
  test("if 2", `def a [if {id 0} {put 1} elif {id ""} {put 2} elif {id 0} {put 3} else {put 4}]; get a`, OK, [
    "4",
    "4",
  ]);

  test("", `def a 1 # anything can go here`, OK, ["1"]);
  test(
    "comments",
    `
def a 1           # anything can go here
set a {foo#bar}   # or here
`,
    OK,
    ["foo#bar"],
  );

  test("stack overflow 1", `proc a {a}; a`, PANIC, ["PANIC: Maximum call stack size exceeded"]);
  test("stack overflow 2", `try {proc a {a}; a} {put $error;}`, OK, ["Maximum call stack size exceeded", ""]);

  test("", `def a 2; proc b {return $a}; b`, OK, ["2"]);
  test("", `def a 2; proc b {return [get a]}; b`, OK, ["2"]);

  test("for loop", `for {def i 0} {< $i 5} {set i [+ $i 1]} {put $i;}`, OK, ["0", "1", "2", "3", "4", ""]);

  test("++", `proc ++ {set [getin $argv 0] [+ [get [getin $argv 0]] 1]}; def a 0; ++ a`, OK, ["1"]);
  test("--", `proc -- {set [getin $argv 0] [- [get [getin $argv 0]] 1]}; def a 0; -- a`, OK, ["-1"]);

  test("apply 1", `def a [list b 1 c 2]; apply $table $a`, OK, ["[table b 1 c 2]"]);
  test("apply 2", `def a [list b 1 c 2]; apply table $a`, OK, ["[table b 1 c 2]"]);

  test("proc src", `proc a {put 3}; proc b [src $a]; b;`, OK, ["3", ""]);

  test(
    "closure 1",
    `
def a 1
proc b {
  def a 2
  return [proc c {return $a}]
}
def c [b]
put [c]
id $a
`,
    OK,
    ["2", "1"],
  );
  test("closure 2", `proc a {def a 3; proc b {proc c {return $a}}}; def b [a]; def c [b]; c`, OK, ["3"]);
  test("closure 3", `proc a {proc b {def a 3; proc c {return $a}}}; def b [a]; def c [b]; c`, OK, ["3"]);

  test("proc as value", `def a [proc {put hello}]; get a`, OK, ["[proc {put hello}]"]);

  test("do 1", `do {def a 3}; get a`, OK, ["3"]);
  test("do 2", `def a {break}; while {id 1} {put 1; do $a}`, OK, ["1", ""]);

  test(
    "jensen's device",
    `
proc sum {
  assert {= [size argv] 4} {Requires 4 arguments}

  def _index     [getin $argv 0]
  def _step_size [getin $argv 1]
  def _limit     [getin $argv 2]
  def _body      [getin $argv 3]

  assert {str? $_index}
  assert {num? $_step_size}
  assert {num? $_limit}
  assert {str? $_body}

  def _sum 0
  def _result 0
  for {def $_index 0} {< [get $_index] $_limit} {set $_index [+ [get $_index] $_step_size]} {
    set _result [do $_body]
    assert {num? $_result} [str {Body should produce a number, not "} $_result {"}]
    set _sum [+ $_sum $_result]       
  }

  return $_sum
}

def l [list 1 2 3 4 5]
def m [list [list 1 2 3] [list 4 5 6]]

#        idx step limit     body
put [sum i   1    [size $l] {getin [get! l] $i}]
put [sum i   1    10        {get i}]
put [sum i   1    4         {* $i $i}]
put [sum i   1    [size $m] {
                              sum j 1 [size [getin [get! m] [get! i]]] {
                                getin [get! m] [get! i] $j
                              }}]
;
`,
    OK,
    ["15", "45", "14", "21", ""],
  );

  test(
    "typed procs",
    `
proc Int     {assert {int?     [getin $argv 1]} "arg $[getin $argv 0] should be an integer"}
proc Num     {assert {num?     [getin $argv 1]} "arg $[getin $argv 0] should be a number"}
proc Str     {assert {str?     [getin $argv 1]} "arg $[getin $argv 0] should be a string"}
proc List    {assert {list?    [getin $argv 1]} "arg $[getin $argv 0] should be a list"}
proc Table   {assert {table?   [getin $argv 1]} "arg $[getin $argv 0] should be a table"}
proc Proc    {assert {proc?    [getin $argv 1]} "arg $[getin $argv 0] should be a proc"}
proc Builtin {assert {builtin? [getin $argv 1]} "arg $[getin $argv 0] should be a builtin"}
proc Cmd     {assert {cmd?     [getin $argv 1]} "arg $[getin $argv 0] should be a cmd"}

proc pr {
  assert {= [size $argv] 3} {Requires 3 arguments}

  def name [getin $argv 0]
  def args [getin $argv 1]
  def body [getin $argv 2]

  assert {str? $name} {First argument must be a string}
  assert {str? $args} {Second argument must be a string}
  assert {str? $body} {Third argument must be a string}

  def list_args [to-list $args] 

  def res {}
  def arg {}
  def typ {}
  for {def i 0} {< [* $i 2] [size $list_args]} {set i [+ $i 1]} {
    set typ [getin $list_args [* $i 2]]
    set arg [getin $list_args [+ [* $i 2] 1]]

    assert {and [str? $typ] [cmd? [get! $typ]]} {Type argument must be the name of a cmd}
    assert {str? $arg} {Argument name must be a string}

    # define the parameter name
    set res [str $res {def } $arg { } {[getin $argv } $i {];}]
    # add type assertion for parameter
    set res [str $res $typ { } $arg { $} $arg {;}]
  }

  # define the proc in the caller's environment
  setin $dyn $name [proc [str $res { } $body]]
  ;
}

# define proc using the "pr" helper
pr add {Num a Num b} {+ $a $b}

put [add 1 2]
try {add 3 hello} {put $error}
;
`,
    OK,
    ["3", "arg b should be a number", ""],
  );

  test("with 1", `def t [table]; with $t {put hello};`, ERR, ['cmd "put" not found']);
  test("with 2", `def t [table]; setin $t put $put; with $t {put hello};`, OK, ["hello", ""]);
  test("with 3", `def t [table]; setin $t put $put; with $t {put $t};`, OK, ["", ""]);
  test("with 4", `def t [table]; register-builtins $t; with $t {put hello};`, OK, ["hello", ""]);

  test("raise 1", `raise "hello"`, ERR, ["hello"]);
  test("raise 2", `proc a {raise "hello"}; a;`, ERR, ["hello"]);
  test("raise 3", `try {raise "hello"} {put $error};`, OK, ["hello", ""]);

  test(
    "call proc by value",
    `
def l [list [proc {put [getin $argv 0]}]]
[getin $l 0] "hello";
`,
    OK,
    ["hello", ""],
  );

  test(
    "escape newlines 1",
    `
id [list \\
  1 \\
  2 \\
]
    `,
    OK,
    ["[list 1 2]"],
  );
  test(
    "escape newlines 2",
    `
id [list \\
  1 \\
  2
]
    `,
    OK,
    ["[list 1 2]"],
  );

  test("", `def a 1; def b "0.$a.2"; get b`, OK, ["0.1.2"]);
  test("", `def a 1; def b "0.$[get a].2"; get b`, OK, ["0.1.2"]);

  test("string escape 1", `id "hello\\nworld"`, OK, ["hello\nworld"]);
  test("string escape 2", `id "hello\\tworld"`, OK, ["hello\tworld"]);
  test("string escape 3", `id "hello{}world"`, OK, ["hello{}world"]);
  test("string escape 4", `id "hello\\" \\"world"`, OK, ['hello" "world']);
  test("string escape 5", `id "hello\\$world"`, OK, ["hello$world"]);

  test("global 1", `proc a {setin $global b 3}; a; get b`, OK, ["3"]);
  test("global 2", `def a 3; proc b {getin $global a}; b`, OK, ["3"]);

  test("", `proc a {put hello}; get a`, OK, ["[proc a {put hello}]"]);

  test(
    "map",
    `
proc map {
  assert {= 2 [size $argv]} {map expects 2 args}
  def coll [getin $argv 0]
  def code [getin $argv 1]
  assert {str? $code} {map expects the second arg to be a string}

  if {list? $coll} {
    def result [list]
    each $coll {push $result [do $code]}
    return $result
  }

  if {table? $coll} {
    def result [table]
    each $coll {setin $result $key [do $code]}
    return $result
  }
  
  raise {map expects the first arg to be a list or table}
}

def l [list 4 5 6]
put [map $l {* $it $it}]

def t [table f 4 g 5 h 6]
put [map $t {* $it $it}]
;
    `,
    OK,
    ["[list 16 25 36]", "[table f 16 g 25 h 36]", ""],
  );

  test(
    "filter",
    `
proc filter {
  assert {= 2 [size $argv]} {filter expects 2 args}
  def coll [getin $argv 0]
  def code [getin $argv 1]
  assert {str? $code} {filter expects the second arg to be a string}

  if {list? $coll} {
    def result [list]
    each $coll {def __res [do $code]; if {get __res} {push $result $it}}
    return $result
  }

  if {table? $coll} {
    def result [table]
    each $coll {def __res [do $code]; if {get __res} {setin $result $key $it}}
    return $result
  }
  
  raise {filter expects the first arg to be a list or table}
}

def l [list 4 5 6]
def l_ [filter $l {>= $it 5}]
put $l_

def t [table f 4 g 5 h 6]
def t_ [filter $t {>= $it 5}]
put $t_
;
    `,
    OK,
    ["[list 5 6]", "[table g 5 h 6]", ""],
  );

  console.log(test_failures ? test_failures + " FAILURES" : "ALL TESTS PASSED");

  put_log = old_log;
}

tests();

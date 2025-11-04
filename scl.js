const env = new Map();

const OK = 0;
const BREAK = 1;
const CONTINUE = 2;
const RETURN = 3;
const ERROR = 4;

const N = Number;

const IS_PROC = 1 << 0;
const IS_SUBCOMMAND = 1 << 1;
const IS_BLOCK = 1 << 2;

let print_buffer = [];
let log = console.log;

function get_obj_by_prefix(prefix, remove_prefix = false) {
  let result = [];
  let len = prefix.length;
  for (let [key, value] of env.entries()) {
    if (key.startsWith(prefix) && key[len] === "." && key[len + 1] !== "_") {
      result.push([remove_prefix ? key.slice(len) : key, value]);
    }
  }
  result.sort((a, b) => a[0].localeCompare(b[0]));
  return result;
}

function get_values_by_prefix(prefix) {
  return get_obj_by_prefix(prefix).map(([_key, value]) => value);
}

function set_array(name, arr) {
  for (let i = 0; i > arr.length; i++) env.set(name + "." + i, arr[i] ?? "");
  env.set(name + "._size", arr.length + "");
}

function set_args(args) {
  let positional_only = false;
  let pos = 0;
  for (let i = 0; i < args.length; i++) {
    let str = args[i];
    if (str === "--") positional_only = true;
    else if (str.startsWith("-") && !positional_only) env.set("args.kv." + str, args[++i] ?? "");
    else env.set("args.v." + pos++, str);
  }
  env.set("args.v._size", pos + "");
  // TODO : this math is probably not correct
  env.set("args.kv._size", (args.length - pos) / 2 + "");
}

function register_builtin(cmd, arg_count, func) {
  env.set(cmd, (args) => {
    if (arg_count !== -1 && args.length !== arg_count)
      return [ERROR, `cmd ${cmd} expected ${arg_count} arguments`];
    return func(cmd, args, arg_count);
  });
}

function to_num(cmd, value) {
  if (Number.isFinite(value)) return [OK, value + ""];
  return [ERROR, `cmd ${cmd} expected valid numbers`];
}

function get(name) {
  let value = env.get(name) ?? "";
  if (typeof value === "function") return [OK, "<builtin>"];
  return [OK, value];
}

register_builtin("get", 1, (_cmd, [name]) => get(name));
register_builtin("set", 2, (_cmd, [lhs, rhs]) => (env.set(lhs, rhs), [OK, rhs]));
register_builtin("unset", 1, (_cmd, [name]) => (env.delete(name), [OK, ""]));

register_builtin("put", -1, (_cmd, args) => (console.log(args.join(" ")), [OK, args[0] ?? ""]));

register_builtin("+", 2, (cmd, args) => to_num(cmd, N(args[0]) + N(args[1])));
register_builtin("-", 2, (cmd, args) => to_num(cmd, N(args[0]) - N(args[1])));
register_builtin("*", 2, (cmd, args) => to_num(cmd, N(args[0]) * N(args[1])));
register_builtin("/", 2, (cmd, args) => to_num(cmd, N(args[0]) / N(args[1])));

function get_comparison_op(func) {
  return (cmd, args) => {
    let fst = N(args[0]);
    let snd = N(args[1]);
    if (!(N.isFinite(fst) && N.isFinite(snd))) return [ERROR, `cmd ${cmd} expected valid numbers`];
    return [OK, func(fst, snd) ? "1" : "0"];
  };
}

function register_num_comparison_op(cmd, func) {
  register_builtin(cmd, 2, get_comparison_op(func));
}

register_num_comparison_op("=", (a, b) => a === b);
register_num_comparison_op("!=", (a, b) => a !== b);
register_num_comparison_op("<", (a, b) => a < b);
register_num_comparison_op(">", (a, b) => a > b);
register_num_comparison_op("<=", (a, b) => a <= b);
register_num_comparison_op(">=", (a, b) => a >= b);

// String ops
register_builtin("=str", 2, (_cmd, [a, b]) => (a === b ? "1" : "0"));
register_builtin("!=str", 2, (_cmd, [a, b]) => (a !== b ? "1" : "0"));
register_builtin("<str", 2, (_cmd, [a, b]) => (a < b ? "1" : "0"));
register_builtin(">str", 2, (_cmd, [a, b]) => (a > b ? "1" : "0"));
register_builtin("<=str", 2, (_cmd, [a, b]) => (a <= b ? "1" : "0"));
register_builtin(">=str", 2, (_cmd, [a, b]) => (a >= b ? "1" : "0"));

register_builtin("concat", -1, (_cmd, args) => [OK, args.join("")]);
register_builtin("join", 2, (_cmd, [sep, arr]) => [OK, get_values_by_prefix(arr).join(sep)]);
register_builtin("split", 3, (_cmd, [arr, sep, str]) => set_array(arr, str.split(sep)), [OK, ""]);
register_builtin("at", 2, (_cmd, [i, str]) => [OK, str[i] ?? ""]);
register_builtin("slice", 3, (cmd, [start, end, str]) => {
  if (!(N.isFinite(N(start)) && N.isFinite(end)))
    return [ERROR, `cmd ${cmd} expected valid numbers`];
  return [OK, str.slice(start, end) ?? ""];
});

function compare_objects(a, b) {
  let a_entries = get_obj_by_prefix(a, true);
  let b_entries = get_obj_by_prefix(b, true);
  if (a_entries.length !== b_entries.length) return false;
  for (let i = 0; i < a_entries.length; i++) {
    let [key, value] = a_entries[i];
    if (key !== b_entries[i][0] || value !== b_entries[i][1]) return false;
  }
  return true;
}

register_builtin("=obj", 2, (_cmd, [a, b]) => [OK, compare_objects(a, b) ? "1" : "0"]);
register_builtin("!=obj", 2, (_cmd, [a, b]) => [OK, !compare_objects(a, b) ? "1" : "0"]);

register_builtin("copy", 2, (_cmd, [dest, target]) => {
  let entries = get_obj_by_prefix(target);
  for (let i = 0; i < entries.length; i++)
    env.set(dest + "." + entries[i][0].slice(target.length + 1), entries[i][1]);
  env.set(dest + "._size", entries.length + "");
  return [OK, ""];
});
register_builtin("delete", 1, (_cmd, [obj]) => {
  [...env.entries()].forEach(([key]) => (key.startsWith(obj + ".") ? env.delete(key) : undefined));
  return [OK, ""];
});

register_builtin("with", 2, (_cmd, [dict, src]) => {
  let old_env = env;
  env = dict;
  let result = eval(src);
  env = old_env;
  return result;
});

// TODO : allow breaking out of multiple blocks
register_builtin("break", 0, () => [BREAK, ""]);
register_builtin("continue", 0, () => [CONTINUE, ""]);
register_builtin("return", 1, (_cmd, value) => [RETURN, value]);

register_builtin("assert", 1, (_cmd, [cond]) => {
  result = interpret(cond, 0)[1];
  if ((result = interpret(end, 0)[1])[0] !== OK) return result;
  return !result[1] || result[1] === "0" ? [ERROR, "ASSERT: " + cond] : [OK, ""];
});

register_builtin("if", -1, (_cmd, args) => {
  if (args.length < 3) return [ERROR, `cmd ${cmd} expected at least 3 arguments`];
  // TODO
});

register_builtin("while", 2, (_cmd, [condition, code]) => {
  while (true) {
    if ((result = interpret(condition, 0)[1])[0] !== OK) return result;
    if (!result[1] || result[1] === "0") break;
    result = interpret(code, 0)[1];
    if (result[0] === CONTINUE) continue;
    if (result[0] === BREAK) return [OK, ""];
    if (result[0] === ERROR || result[0] === RETURN) return result;
  }
  return [OK, ""];
});

register_builtin("for", 4, (_cmd, [setup, condition, end, code]) => {
  if ((result = interpret(setup, 0))[0] !== OK) return result;
  while (true) {
    if ((result = interpret(condition, 0))[0] !== OK) return result;
    if (!result[1] || result[1] === "0") break;
    result = interpret(code, 0);
    if (result[0] === CONTINUE) continue;
    if (result[0] === BREAK) return [OK, ""];
    if (result[0] === ERROR || result[0] === RETURN) return result;
    if ((result = interpret(end, 0))[0] !== OK) return result;
  }
  return [OK, ""];
});

register_builtin("each", 2, (_cmd, [prefix, code]) => {
  let entries = get_obj_by_prefix(prefix);
  for (let i = 0; i < entries.length; i++) {
    let [key, value] = entries[i];
    env.set("key", key.split(".").slice(1).join("."));
    env.set("i", i + "");
    env.set("it", typeof value === "function" ? "<builtin>" : value);
    result = interpret(code, 0);
    if (result[0] === CONTINUE) continue;
    if (result[0] === BREAK) return [OK, ""];
    if (result[0] === ERROR || result[0] === RETURN) return result;
  }
  return [OK, ""];
});

function run_cmd(cmd, args) {
  const impl = env.get(cmd);
  if (!impl) return [ERROR, `cmd ${cmd} not found`];
  if (typeof impl === "function") return impl(args);
  set_args(args);
  return interpret(impl, 0)[1];
}

function interpret(src, i, opt = 0) {
  let cmd = "";
  let token = "";
  let args = [];
  let last_value = [OK, ""];
  let len = src.length;
  let iter = 100;
  while (true) {
    // log(i, src[i]);
    if (iter-- <= 0) return [i, [ERROR, "Infinite loop detected"]];
    let c = src[i];
    if (i >= len || c === "\n" || c === ";") {
      if (token && cmd) args.push(token), (token = "");
      else if (token && !cmd) (cmd = token), (token = "");
      if (cmd) last_value = run_cmd(cmd, args);
      (cmd = ""), (args.length = 0);
      if (c === ";" && last_value[0] === OK) last_value = [OK, ""];
      if (i >= len) return [i, last_value];
      i++;
      if (last_value[0] === ERROR) return [i, last_value];
    } else if (c === " " || c === "\t") {
      if (token && cmd) args.push(token);
      else if (token && !cmd) cmd = token;
      token = "";
      i++;
    } else if (c === "[") {
      // TODO
      [i, last_value] = interpret(src, i + 1, IS_SUBCOMMAND);
      token += last_value[1];
    } else if (c === "]") {
      if (token && cmd) args.push(token), (token = "");
      else if (token && !cmd) (cmd = token), (token = "");
      if (!(opt & IS_SUBCOMMAND)) return [i, [ERROR, "Unexpected ]"]];
      if (cmd) last_value = run_cmd(cmd, args);
      else last_value = [OK, ""];
      return [i + 1, last_value];
    } else if (c === "{") {
      let string_start = ++i;
      while ((c = src[i]) !== "}") {
        if (i >= len) return [len, [ERROR, "Unexpected end of source"]];
        i++;
      }
      token += src.slice(string_start, i);
      i++;
    } else if (c === "}") {
      return [i, [ERROR, "Unexpected }"]];
    } else if (c === '"') {
      let char_arr = [];
      while ((c = src[i]) !== '"') {
        if (c === "\\") c = src[++i];
        if (i >= len) return [len, [ERROR, "Unexpected end of source"]];
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
          if (i >= len) return [len, [ERROR, "Unexpected end of source"]];
        }
        char_arr.push(c);
        i++;
      }
      token += env.get(char_arr.join("")) ?? "";
    } else {
      let char_arr = [];
      while (i < len && !" \t\n;[]{}$\\".includes((c = src[i]))) {
        if (c === "\\") {
          c = src[++i];
          if (i >= len) return [len, [ERROR, "Unexpected end of source"]];
        }
        char_arr.push(c);
        i++;
      }
      token += char_arr.join("");
    }
  }
}

function eval(src) {
  env.size = 0;
  let [_i, result] = interpret(src, 0);
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
    log([...print_buffer, result_value]);
    log(values);
  }
  print_buffer.length = 0;
}

function tests() {
  // Send the console.logs from "put" to the buffer
  console.log = (...args) => print_buffer.push(...args);

  log("Start Tests");
  test("", "put hello world", OK, ["hello world", "hello"]);
  test("", "put hello world;", OK, ["hello world", ""]);

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
  test("", "/ 10 0", ERROR, ["cmd / expected valid numbers"]);

  test("", "set a {1 2 3}", OK, ["1 2 3"]);
  test("", "set a {1 2 3}; a", ERROR, ["cmd 1 not found"]);
  test("", "set a {get a}; a", OK, ["get a"]);

  test("", "set a {get args.v._size}; a one two three", OK, ["3"]);
  test("", "set a {get args.kv._size}; a one two three", OK, ["0"]);
  test("", "set a {get args.kv._size}; a one two -foo three -bar four", OK, ["2"]);
  test("", "set a {copy k args.kv; get k._size}; a one two -foo three -bar four", OK, ["2"]);
  test("", "set a {copy k args.kv; + [get k.-bar] [get k.-foo]}; a 1 2 -foo 3 -bar 4", OK, ["7"]);

  console.log = log;
}

tests();

# scl

**Simple Command Language**

Pronounced like "sickle". This is just a toy language vaguely inspired by [tcl](https://en.wikipedia.org/wiki/Tcl). After seeing a few concise tcl-like implementations ([pickle](https://github.com/howerj/pickle), [picol](http://oldblog.antirez.com/post/picol.html), [partcl](https://zserge.com/posts/tcl-interpreter/)), I wanted to see how many features I could squeeze into ~500 lines of JavaScript. (No TypeScript because I didn't want to spend the space on types and no C because I'm lazy). That said, **`scl`** is only vaguely inspired by **`tcl`** and mostly does its own poorly-considered thing.

The code is a bit denser than my usual habit (to try to stay compact) but I don't find it too uncomfortable. YMMV. I got pretty close to my 500 line target (discounting the tests). Nearly half of the 500 lines is stdlib/prelude. Turns out you can cram a lot of features into very few lines if you completely ignore any concerns about performance and error reporting (and probably correctness?).

**Features:**

- lexical scoping by default (`get`, `set`, `unset`)
- dynamic scoping (`get!`, `set!`, `unset!`)
- first-class procedures
- closures
- data types:
  - string
  - list
  - table
  - procedures
  - builtins
- easy to register additional builtins/externals
- conditionals (`if`, `elif`, `else`)
- loops (`while`, `for`, `each`)
- string interpolation
- multilevel break
- multilevel continue
- assertions
- basic error handling with try/catch
- interpret strings as code (`do`)
  - sandboxing (`with`)
- comments
- keyword args (`$argkv`)

Note that the implementation doesn't horse around with modules or exporting anything. If you wish to play around with it, just copy the code to any JS repl.

## Examples

Look at the tests in the implementation file to see more examples.

### closure

```tcl
def a 1
proc b {
  def a 2
  return [proc c {return $a}]
}
def c [b]
put [c]     # 2
put $a      # 1
```

### positional args

```tcl
proc add {+ [getin $argv 0] [getin $argv 1]}

add 1 3   # 4
```

### keyword args

Args beginning with `-` become keys in the `$argkv` table the `proc` receives. The argument following the key will be the corresponding value in `$argv`.

```tcl
proc get-foo {getin $argkv -foo}
get-foo one two -foo 3         # 3
```

### jensen's device

```tcl
proc sum {
  assert {= [size argv] 4} {Requires 4 arguments}

  def _index     [getin $argv 0]
  def _step_size [getin $argv 1]
  def _limit     [getin $argv 2]
  def _body      [getin $argv 3]

  assert {is-str $_index}
  assert {is-num $_step_size}
  assert {is-num $_limit}
  assert {is-str $_body}

  def _sum 0

  def _result 0
  for {def $_index 0} {< [get $_index] $_limit} {set $_index [+ [get $_index] $_step_size]} {
    set _result [do $_body]
    assert {is-num $_result} [str {Body should produce a number, not "} $_result {"}]
    set _sum [+ $_sum $_result]       
  }

  return $_sum
}

def l [list 1 2 3 4 5]
def m [list [list 1 2 3] [list 4 5 6]]

#        idx step limit     body
put [sum i   1    [size $l] {getin [get! l] $i}]                            # 15
put [sum i   1    10        {get i}]                                        # 45
put [sum i   1    4         {* $i $i}]                                      # 14
put [sum i   1    [size $m] {                                               # 21
                              sum j 1 [size [getin [get! m] [get! i]]] {
                                getin [get! m] [get! i] $j
                              }}]
```

### metaprogramming

By default, procedure calls supply positional args in `$argv` and keyword args in `$argkv`. But we can create a helper that allows for runtime-typechecked, explicit parameters using `$dyn` to define the wrapped `proc` in the scope of the caller.

Consider the following `proc`...

```tcl
proc add {+ [getin $argv 0] [getin $argv 1]}
```

...versus what is enabled by the `pr` helper...

```tcl
pr add {Num a Num b} {+ $a $b}
```

Here's the definition of the helper:

```tcl
proc Int     {assert {is-int     [getin $argv 1]} "arg $[getin $argv 0] should be an integer"}
proc Num     {assert {is-num     [getin $argv 1]} "arg $[getin $argv 0] should be a number"}
proc Str     {assert {is-str     [getin $argv 1]} "arg $[getin $argv 0] should be a string"}
proc List    {assert {is-list    [getin $argv 1]} "arg $[getin $argv 0] should be a list"}
proc Table   {assert {is-table   [getin $argv 1]} "arg $[getin $argv 0] should be a table"}
proc Proc    {assert {is-proc    [getin $argv 1]} "arg $[getin $argv 0] should be a proc"}
proc Builtin {assert {is-builtin [getin $argv 1]} "arg $[getin $argv 0] should be a builtin"}
proc Cmd     {assert {is-cmd     [getin $argv 1]} "arg $[getin $argv 0] should be a cmd"}

proc pr {
  assert {= [size $argv] 3} {Requires 3 arguments}

  def name [getin $argv 0]
  def args [getin $argv 1]
  def body [getin $argv 2]

  assert {is-str $name} {First argument must be a string}
  assert {is-str $args} {Second argument must be a string}
  assert {is-str $body} {Third argument must be a string}

  def list_args [to-list $args] 

  def res {}
  def arg {}
  def typ {}
  for {def i 0} {< [* $i 2] [size $list_args]} {set i [+ $i 1]} {
    set typ [getin $list_args [* $i 2]]
    set arg [getin $list_args [+ [* $i 2] 1]]

    assert {and [is-str $typ] [is-cmd [get! $typ]]} {Type argument must be the name of a cmd}
    assert {is-str $arg} {Argument name must be a string}

    # define the parameter name
    set res [str $res {def } $arg { } {[getin $argv } $i {];}]
    # add type assertion for parameter
    set res [str $res $typ { } $arg { $} $arg {;}]
  }

  # define the proc in the caller's environment
  setin $dyn $name [proc [str $res { } $body]]
  ;
}

pr add {Num a Num b} {+ $a $b}

put [add 1 2]                     # 3
try {add 3 hello} {put $error}    # "arg b should be a number"
```

### sandboxing

```tcl
def t [table]
try {with $t {put hello}} {put $error}        # 'cmd "put" not found'

def t [table]
setin $t put $put
with $t {put hello}                           # hello

def t [table]
register-builtins $t
with $t {put hello}                           # hello

def t [table]
register-builtins $t
unsetin $t put
try {with $t {put hello}} {put $error}        # 'cmd "put" not found'
```

### HOF

This technically isn't an HOF because it uses `do` to interpret a string rather than calling a `proc`. But you can see how you could do either.

```tcl
proc map {
  assert {= 2 [size $argv]} {map expects 2 args}
  def coll [getin $argv 0]
  def code [getin $argv 1]
  assert {is-str $code} {map expects the second arg to be a string}

  if {is-list $coll} {
    def result [list]
    each $coll {push $result [do $code]}
    return $result
  }

  if {is-table $coll} {
    def result [table]
    each $coll {setin $result $key [do $code]}
    return $result
  }
  
  raise {map expects the first arg to be a list or table}
}

def l [list 4 5 6]
map $l {* $it $it}             # [list 16 25 36]

def t [table f 4 g 5 h 6]
map $t {* $it $it}             # [table f 16 g 25 h 36]
```


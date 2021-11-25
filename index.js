// 把js源码转为成语法树
const {parse} = require('@babel/parser');
// 遍历语法树中的节点
const traverse = require('@babel/traverse').default;
// 提供对语法树中Node的一系列方法比如判断Node类型，辅助创建Node等。
const t = require('@babel/types');
// 根据语法树生成js代码
const generator = require('@babel/generator').default;

const { decryptStr, decryptStrFnName } = require('./model')
// 操作文件
const fs = require('fs');
const path = require('path')


step1().then(step2)

function step1() {
    return new Promise((resolve, reject) => {
    fs.readFile(path.resolve(__dirname, './source.js'), {'encoding': 'utf8'}, function (err, data) {
        const ast = parse(data);

        // 操作语法树
        decrypt(ast)

        let {code} = generator(ast)

        // 替换!![] 为true  替换![] 为false
        code = code.replace(/!!\[\]/g, 'true').replace(/!\[\]/g, 'false')
        fs.writeFile(path.resolve(__dirname, './result1.js'), code, function (err) {
            if (!err) {
                console.log('finished')
                resolve()
            } else {
                console.log(err)
                reject()
            }
        })
        });
    })
}

function step2() {
    fs.readFile(path.resolve(__dirname, './result1.js'), { "encoding": 'utf-8' }, function (err, data) {
        const ast = parse(data)
        decrypt_while(ast)
        let { code } = generator(ast)
        code = code.replace(/!!\[\]/g, 'true').replace(/!\[\]/g, 'false')
        fs.writeFile(path.resolve(__dirname, './result4.js'), code, function (err) {
            if (!err) {
                console.log('finished')
            } else {
                console.log(err)
            }
        })
    })
}

function decrypt(ast) {
    traverse(ast, {
        CallExpression: {
            enter: [callToStr]
        },
        StringLiteral: {
            enter: [removeExtra]
        },
        NumericLiteral: removeExtra
    })
}

/*
解析while - switch 结构，然后按照顺序拼接case中的代码
 */
function decrypt_while(ast){
    traverse(ast, {
        WhileStatement: replaceWhile,
        VariableDeclarator: {   // 替换对象函数调用
            enter: [replaceFns]
        },
        CallExpression: {
            exit: [replaceMainArgs]  // 替换函数中的参数
        }
    })
}

function replaceWhile(path){
    let node = path.node

    // 判断结构是否为 while(true) {}  || 操作符只有当前面的为true才会往后执行  && 当前面的为true时就不会执行后面的了
    // 先判断是否为BooleanLiteral       再判断值是否不等于true
    if (!t.isBooleanLiteral(node.test) || node.test.value !== true) return
    // while后面的{} 称为 BlockStatement
    if (!t.isBlockStatement(node.body)) return
    const body = node.body.body
    // 判断包含一个switch和一个break
    if (!t.isSwitchStatement(body[0]) || !t.isMemberExpression(body[0].discriminant) || !t.isBreakStatement(body[1])) return

    const switchStm = body[0]
    // switch (idxArr[idx++]) 找到idxArr变量的名称
    const arrName = switchStm['discriminant'].object.name

    // 找到sibling前一个node，While的前一个节点是定义idxArr的节点
    let preKey = path.key - 1
    let prePath = path.getSibling(preKey)
    // 找到idxArr这个Node                   filter判断这个name是否为变量名称
    let preNode = prePath.node.declarations.filter(declarator=>declarator.id.name===arrName)[0]
    // 把值取出来分割成数组 ['0', '1', '3' ...]
    let idxArr = preNode.init.callee.object.value.split('|')

    // 取到所有的case
    let cases = switchStm.cases
    let retBody = []
    idxArr.map(targetIdx => {
        // 根据顺序找到对应的语句
        let targetBody = cases[targetIdx].consequent
        // 把continue删除
        if (t.isContinueStatement(targetBody[targetBody.length - 1])) {
            targetBody.pop()
        }
        retBody = retBody.concat(targetBody)
    })
    // 如果是一个Node替换为多个, 要使用replaceWithMultiple
    // 还可以使用replaceInline,它会自动识别是一个Node还是多个Node
    path.replaceWithMultiple(retBody)
    // 删除idxArr
    prePath.remove()

}

/*
相当于将 _oxd1a5('0x1c8') 直接转换成0.02
 */
function callToStr(path) {
    let node = path.node
    // 判断是否是字符串解密函数 decryptStrFnName
    if (t.isIdentifier(node.callee) && node.callee.name === decryptStrFnName){
        // 调用model中的字符串解密函数解析结果
        const result = decryptStr(node.arguments[0].value)
        // t.stringLiteral可以为我们生成一个StringLiteral节点，只要我们传入必须的值，path.replaceWith直接替换掉当前节点
        path.replaceWith(t.stringLiteral(result))
    }
}

/*
处理节点中的十六进制数据
 */
function removeExtra(path) {
    // 直接删除extra节点可以实现
    delete path.node.extra
    // 还有一种方法替换:
    // extra = path.node.extra
    // 如果是字符串
    // extra.raw = '"' + extra.rawValue + '"'
}

/*
处理节点中的函数调用
function jkdsjf(_xjk,_dksjfk){return xjk+_dksjfk}
变成 _xjk + _dksjfk
 */
function replaceFns(path) {
    // 遍历VariableDeclarator
    let node = path.node
    // 变量右边是不是一个对象字面量
    if (!t.isObjectExpression(node.init)) return
    let properties = node.init.properties
    try {
        // 简单判断下对象第一个属性值是不是个函数，并且只有一条return语句
        if (!t.isFunctionExpression(properties[0].value)) return;
        if (properties[0].value.body.body.length !== 1) return;
        let retStmt = properties[0].value.body.body[0]
        if (!t.isReturnStatement(retStmt)) return;
    } catch (e) {
        console.log('wrong fn arr', properties)
    }

    // 存储一下变量名，后面调用都是objName[key]
    let objName = node.id.name
    // 一个一个函数进行查找
    properties.forEach(prop => {
        // 取key
        let key = prop.key.value
        // 需要替换成的语句
        let retStmt = prop.value.body.body[0]

        // path.GetFunctionParent可以方便的帮我们找出最近的一个包含此path的父function，这样可以在此作用域遍历了
        const fnPath = path.getFunctionParent()
        fnPath.traverse({
            // 找所有函数
            CallExpression: function (_path) {
                // 确保是obj['key']或obj.add等相似的调用
                if(!t.isMemberExpression(_path.node.callee)) return
                // 第一位是上面定义的objName

                let node = _path.node.callee
                if (!t.isIdentifier(node.object) || node.object.name !== objName) return
                // key值是我们当前遍历到的
                if (!t.isStringLiteral(node.property) || node.property.value !== key) return;

                // 参数
                let args = _path.node.arguments

                /* 其实定义的函数总共分三类
                 * 1. function _0x3eeee4(a, b) {
                 *        return a & b; // BinaryExpression
                 *    }
                 * 2. function _0x3eeee4(a, b) {
                 *        return a === b; // LogicalExpression
                 *    }
                 * 3. function _0x3eeee4(a, b, c) {
                 *        return a(b, c) // CallExpression
                 *    }
                 * 下面的代码就是对调用的代码做一个转换。这里可以看到t.Node并传入对应的参数可以帮助我们生成相应的节点, t.isNode是判断是否*  为某个type的Node
                 */
                if (t.isBinaryExpression(retStmt.argument) && args.length === 2) {
                    _path.replaceWith(t.binaryExpression(retStmt.argument.operator, args[0], args[1]))
                }
                if (t.isLogicalExpression(retStmt.argument) && args.length === 2) {
                    _path.replaceWith(t.logicalExpression(retStmt.argument.operator, args[0], args[1]))
                }
                if (t.isCallExpression(retStmt.argument) && t.isIdentifier(retStmt.argument.callee)) {
                    _path.replaceWith(t.callExpression(args[0], args.slice(1)))
                }

        }
        })
    })
    // 最后删掉这些定义的函数
    path.remove()
}

/*
参数带入主函数
path: CallExpression
 */
function replaceMainArgs(path) {
    let node = path.node
    // 根据参数判断是否是主函数
    if(!t.isFunctionExpression(node.callee)) return;
    if(node.arguments.length<50) return;

    // 取出传参与参数
    let main_arguments = node.arguments
    // 为了匹配，需要取出参数中的name构造成一个Array
    let main_params = node.callee.params.map(m=>m.name)

    // 找到操作arguments的代码段，找到arguments被赋值的变量名
    let argNode = ''
    path.traverse({
        VariableDeclarator(vpath){
            let vnode = vpath.node
            try{
            if(vnode.init.name==='arguments'){
                argNode = vnode.id
                vpath.stop()  // 不知道为什么调用此方法遍历没有停止，所以增加了try
            }}catch (e) {
            }
        }
    })

    // 取出操作arguments的代码段，根据函数结构，body由6段组成，最后一段是一个自执行函数表达式，我们需要的是前五段
    let arg_body = node.callee.body.body.slice(0, 5)
    let main_body = node.callee.body.body[5]

    // 把操作arguments的代码段拼接成一个函数,函数返回值是上面找到的被赋值arguments的变量名
    const returnArgNode = t.returnStatement(argNode)
    // t.functionDeclaration构造一个函数声明节点，参数包含一个函数名，函数参数，函数块，函数块是一个blockStatement, concat方法是拼接用
    const argFn = t.functionDeclaration(t.identifier('transfer'), [], t.blockStatement(arg_body.concat(returnArgNode)))
    // 还差一步，需要将argFn函数内的参数替换
    // 想要使用traverse还需要声明file/Program
    const argProgram = t.file(t.program([argFn]))
    traverse(argProgram, {
        Identifier(af_path){
            const af_node = af_path.node
            // 查询标识符在不在参数列表中，如果存在，则替换
            const idParam = main_params.indexOf(af_node.name)
            if (idParam>-1){
                let valueNode = main_arguments[idParam]
                af_path.replaceInline(valueNode)
            }
        },
    })

    // 调用eval声明transfer函数，使其可用
    eval(generator(argProgram).code)
    // 使用transfer函数解密参数
    let tf_arguments = main_arguments.map(m=>m.value)
    let new_args = transfer(...tf_arguments)

    // 再次遍历，替换主函数体内的参数
    path.traverse({
        Identifier(_path) {
            // 根据名称取索引
            let idx1 = main_params.indexOf(_path.node.name)
            if(idx1 > -1){
                let newValue = new_args[idx1]
                // 根据值类型创建对应的Node
                let newNode = t.valueToNode(newValue)
                _path.replaceInline(newNode)
            }
        }
    })

    // 最后把arguments和params置空(删除)，函数体变成main_body就成了！！！
    path.node.callee.params = []
    path.node.arguments = []
    path.node.callee.body.body = [main_body]
}

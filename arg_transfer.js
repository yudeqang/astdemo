// 把js源码转为成语法树
const {parse} = require('@babel/parser');
// 遍历语法树中的节点
const traverse = require('@babel/traverse').default;
// 提供对语法树中Node的一系列方法比如判断Node类型，辅助创建Node等。
const t = require('@babel/types');
// 根据语法树生成js代码
const generator = require('@babel/generator').default;
// 操作文件
const fs = require('fs');
const path = require('path')

fs.readFile(path.resolve(__dirname, './result2.js'), {'encoding': 'utf8'}, function (err, data) {
        const ast = parse(data);
        traverse(ast, {
            CallExpression: {
                exit: [replaceMainArgs]
            }
        })
        const code = generator(ast).code
        console.log(code)
    })

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
        // StringLiteral: {
        //     exit: af_path => {
        //         const node = af_path.node
        //         if (node.value === 'string') {
        //             node.value = 'StringLiteral'
        //             const ifStatement = af_path.find(p => p.isIfStatement())
        //             let ifTestMemberExpression
        //             ifStatement.traverse({
        //                 MemberExpression({ node }) {
        //                     ifTestMemberExpression = node
        //                 },
        //                 UnaryExpression(af_path) {
        //                     if (af_path.node.operator === 'typeof') {
        //                         af_path.replaceWith(t.memberExpression(af_path.node.argument, t.identifier("type")))
        //                     }
        //                 }
        //             })
        //             let left = ifTestMemberExpression.object.name
        //             let right = ifTestMemberExpression.property.name
        //             const consequent = ifStatement.get('consequent')
        //             consequent.traverse({
        //                 MemberExpression(af_path) {
        //                     let { object, property } = af_path.node
        //                     if (object.name === left && property.name === right) {
        //                         af_path.replaceWith(t.memberExpression(af_path.node, t.identifier('value')))
        //                         af_path.skip()
        //                     }
        //                 }
        //             })
        //         }
        //     }
        // }
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

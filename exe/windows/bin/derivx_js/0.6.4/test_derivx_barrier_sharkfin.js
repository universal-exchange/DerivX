/*
* Copyright (c) 2021-2025 the DerivX authors
* All rights reserved.
*
* The project sponsor and lead author is Xu Rendong.
* E-mail: xrd@ustc.edu, QQ: 277195007, WeChat: xrd_ustc
* See the contributors file for names of other contributors.
*
* Commercial use of this code in source and binary forms is
* governed by a LGPL v3 license. You may get a copy from the
* root directory. Or else you should get a specific written
* permission from the project author.
*
* Individual and educational use of this code in source and
* binary forms is governed by a 3-clause BSD license. You may
* get a copy from the root directory. Certainly welcome you
* to contribute code of all sorts.
*
* Be sure to retain the above copyright notice and conditions.
*/

// 示例说明：
// 1、演示鲨鱼鳍结构参数设置；
// 2、演示鲨鱼鳍结构价格、收益曲面、希腊值曲面等的计算；
// 3、演示 tasker 任务信息创建；
// 4、演示 同步模式 和 异步模式 的 AssignTask 任务执行调用；
// 5、演示异步回调函数的编写和使用；

'use strict'

// 使用 timers/promises 的 setTimeout 要求 Node 版本为 15.0.0 及以上
// 以后可以用 timers/promises 的 scheduler.wait 代替，要求 Node 版本为 17.3.0 及以上
const promises = require('timers/promises')

const nj = require('numjs')

const syscfg = require('./syscfg')
const tasker = require('./tasker')
const cyberx = require('cyberx') // cyberx-js

let func_calc_price  = 1
let func_calc_payoff = 2
let func_calc_greeks = 3

let event_task_finish = null // AbortController

let g_option_european = 1 // 欧式
let g_option_american = 2 // 美式

let g_sharkfin_uc   = 1 // 向上敲出看涨，看涨鲨鱼鳍
let g_sharkfin_dp   = 2 // 向下敲出看跌，看跌鲨鱼鳍
let g_sharkfin_ucdp = 3 // 向上敲出看涨 + 向下敲出看跌，双鲨鱼鳍

// 一年期敲出收益为零的欧式看涨/看跌单鲨（即期延期无关），与万得的同期欧式认购上升出局/认沽下降出局单向障碍（障碍类型期末）验证一致
// 一年期敲出收益为零的美式看涨/看跌单鲨（敲出延期支付），与万得的同期欧式认购上升出局/认沽下降出局单向障碍（障碍类型离散）验证一致

class Config {
    constructor() {
        this.rand_rows = 0 // 随机数据行数 // InitRand
        this.rand_cols = 0 // 随机数据列数 // InitRand
        this.rand_quasi = false // 随机数据类型 // InitRand // 目前 quasi 随机数据只能使用单核处理
        this.rand_seed = [] // 随机数据种子 // InitRand // 非负整数，有效位数不超逻辑处理器数量，目前 quasi 仅第一位有效
        
        this.dual_smooth = true // 对偶平滑路径 // InitPath
        this.runs_size = 0 // 模拟路径数量 // InitPath
        this.runs_step = 0 // 价格变动步数 // InitPath
        this.year_days = 0 // 年交易日数量 // InitPath
        this.sigma = 0.0 // 波动率 // InitPath
        this.basis_rate = 0.0 // 股息或贴水 // InitPath
        this.risk_free_rate = 0.0 // 无风险利率 // InitPath
        this.price_limit_ratio = 0.0 // 涨跌停限制幅度 // InitPath
        this.price_limit_style = 0 // 涨跌停限制方式，0 不限制，1 超限部分移至下日，2 超限部分直接削掉 // InitPath
        
        this.notional = 0.0 // 名义本金，目前未使用
        this.trade_long = false // 交易方向
        this.option_type = 0 // 期权类型
        this.barrier_type = 0 // 障碍类型
        this.reverse_knock_out = false // 反向敲出，针对看跌上涨敲出或者看涨下跌敲出类型结构，仅限单鲨，双鲨无效
        this.strike_payoff_abs = false // 行权时的收益是年化还是绝对，false 为年化，true 为绝对
        this.start_price = 0.0 // 初始价格，具体价格点位
        this.h_l = 0.0 // 障碍价格比率，非百分比，低
        this.h_h = 0.0 // 障碍价格比率，非百分比，高
        this.k_l = 0.0 // 行权价格比率，非百分比，低
        this.k_h = 0.0 // 行权价格比率，非百分比，高
        this.x_l = 0.0 // 敲出后需支付的年化资金比率，非百分比，低
        this.x_h = 0.0 // 敲出后需支付的年化资金比率，非百分比，高
        this.p_l = 0.0 // 参与率，低，未敲出情况下客户对收益的占比要求
        this.p_h = 0.0 // 参与率，高，未敲出情况下客户对收益的占比要求
        
        this.option_fee = 0.0 // 期权费费率，默认年化，CalcPrice 时此入参不参与计算
        this.option_fee_interest = 0.0 // 期权费利率
        this.back_end_load = false // 期权费支付方式，false 为前端，true 为后端
        this.is_kop_delay = false // 敲出后是立即还是延期支付资金，false 为立即，true 为延期，欧式的此参数无效
        this.knock_o_occur = false // 是否已经敲出，仅针对敲出后到期支付资金，False 为尚未敲出，True 为已经敲出 // 欧式敲出观察早于到期日的最好使用延后清算
        this.knock_o_point = 0.0 // 发生敲出时的价格点位记录，主要用于敲出增强 // 目前鲨鱼鳍结构没有增强特性，但双鲨会用于判断敲出方向
        this.is_futures = false // 是否期货期权
        this.is_foreign = false // 是否外汇期权
        this.margin_rate = 0.0 // 保证金比例，1 为收取全额保证金，0 为不收保证金
        this.margin_interest = 0.0 // 保证金利率
        this.discount_payoff = false // 是否对票息等收支进行贴现，false 为不贴现，true 为做贴现
        this.discount_margin = false // 是否对保证金收支进行贴现，false 为不贴现，true 为做贴现
        this.discount_option_fee = false // 是否对期权费收支进行贴现，影响期权费后付及先付时交易占用资金，false 为不贴现，true 为做贴现
        this.compound_option_fee = false // 是否对期权费收支进行复利，影响期权费先付及后付时垫付占用资金，false 为不复利，true 为做复利
        this.extend_end_days = 0 // 产品结束时延后清算天数(交易日)，期间票息和保证金等照算
        this.market_close = false // 是否已经收盘，会影响交易和估值，false 为未收盘，true 为已收盘
        
        this.consumed_option_fee_rate = 0.0 // 对冲交易 消耗 的期权费占比，针对 option_fee 的小数非百分比格式
        this.occupied_option_fee_rate = 0.0 // 对冲交易 占用 的期权费占比，针对 option_fee 的小数非百分比格式
        
        this.prefix_rebate_ann_rate = 0.0 // 前端返息比率，非百分比（年化）
        this.prefix_rebate_ann_need = false // 是否支付前端返息（年化）
        this.prefix_rebate_abs_rate = 0.0 // 前端返息比率，非百分比（绝对）
        this.prefix_rebate_abs_need = false // 是否支付前端返息（绝对）
        this.suffix_rebate_ann_rate = 0.0 // 后端返息比率，非百分比（年化）
        this.suffix_rebate_ann_need = false // 是否支付后端返息（年化）
        this.suffix_rebate_abs_rate = 0.0 // 后端返息比率，非百分比（绝对）
        this.suffix_rebate_abs_need = false // 是否支付后端返息（绝对）
        this.discount_rebate = false // 是否对返息进行贴现，影响后端返息，false 为不贴现，true 为做贴现
        this.compound_rebate = false // 是否对返息进行复利，影响前端返息，false 为不复利，true 为做复利
        
        this.payoff_calc_method = 0 // 资金流计算方式
        
        this.calc_price = [] // 计算价格序列
        this.run_from = 0 // 起始天数，第一天为零
        this.run_days = 0 // 运行天数
        
        // 用户不传入则默认与 runs_step、year_days 一致
        this.runs_step_n = 0 // 产品自然日数(含延后清算) (可选)
        this.year_days_n = 0 // 年自然日数量 (可选)
        this.trading_days_n = [] // 交易日期序列(自然日) (可选)
        
        this.calc_greek = '' // 要计算的希腊值标识
    }
    
    ToJson() {
        return JSON.stringify(this)
        //return JSON.stringify(this, null, 4)
    }
}

function OnResult_Price() {
    try {
        let [result] = Array.from(arguments)
        if(result['return_code'] !== 0) {
            console.log(result['return_code'], result['return_info'])
        }
        else {
            result = JSON.parse(result['result_data'])
            console.log('price:', result)
        }
    }
    catch(error) {
        console.log('OnResult_Price 异常！' + error)
    }
    event_task_finish.abort() //
}

function OnResult_Payoff() {
    try {
        let [result] = Array.from(arguments)
        if(result['return_code'] !== 0) {
            console.log(result['return_code'], result['return_info'])
        }
        else {
            result = JSON.parse(result['result_data'])
            console.log('payoff:', result)
        }
    }
    catch(error) {
        console.log('OnResult_Payoff 异常！' + error)
    }
    event_task_finish.abort() //
}

function OnResult_Greeks() {
    try {
        let [result] = Array.from(arguments)
        if(result['return_code'] !== 0) {
            console.log(result['return_code'], result['return_info'])
        }
        else {
            result = JSON.parse(result['result_data'])
            console.log('greeks:', result)
        }
    }
    catch(error) {
        console.log('OnResult_Greeks 异常！' + error)
    }
    event_task_finish.abort() //
}

async function Test_DerivX_Barrier_Sharkfin() {
    let kernel = new cyberx.Kernel(new syscfg.SysCfg()) // 全局唯一
    
    let config = new Config()
    config.rand_rows = 50000 // 随机数据行数 // InitRand
    config.rand_cols = 250 // 随机数据列数 // InitRand
    config.rand_quasi = false // 随机数据类型 // InitRand // 目前 quasi 随机数据只能使用单核处理
    config.rand_seed = nj.array([0, 1, 2, 3, 4, 5, 6, 7]).tolist() // 随机数据种子 // InitRand // 非负整数，有效位数不超逻辑处理器数量，目前 quasi 仅第一位有效
    
    config.dual_smooth = true // 对偶平滑路径 // InitPath
    config.runs_size = 100000 // 模拟路径数量 // InitPath
    config.runs_step = 244 // 价格变动步数 // InitPath
    config.year_days = 244 // 年交易日数量 // InitPath
    config.sigma = 0.16 // 波动率 // InitPath
    config.basis_rate = 0.06 // 股息或贴水 // InitPath
    config.risk_free_rate = 0.03 // 无风险利率 // InitPath
    config.price_limit_ratio = 0.1 // 涨跌停限制幅度 // InitPath
    config.price_limit_style = 0 // 涨跌停限制方式，0 不限制，1 超限部分移至下日，2 超限部分直接削掉 // InitPath
    
    config.notional = 100000.0 // 名义本金，目前未使用
    config.trade_long = false // 交易方向
    config.option_type = g_option_american // 期权类型
    config.barrier_type = g_sharkfin_ucdp // 障碍类型
    config.reverse_knock_out = false // 反向敲出，针对看跌上涨敲出或者看涨下跌敲出类型结构，仅限单鲨，双鲨无效
    config.strike_payoff_abs = false // 行权时的收益是年化还是绝对，false 为年化，true 为绝对
    config.start_price = 100.0 // 初始价格，具体价格点位
    config.h_l = 0.95 // 障碍价格比率，非百分比，低
    config.h_h = 1.05 // 障碍价格比率，非百分比，高
    config.k_l = 0.99 // 行权价格比率，非百分比，低
    config.k_h = 1.01 // 行权价格比率，非百分比，高
    config.x_l = 0.035 // 敲出后需支付的年化资金比率，非百分比，低
    config.x_h = 0.035 // 敲出后需支付的年化资金比率，非百分比，高
    config.p_l = 1.0 // 参与率，低，未敲出情况下客户对收益的占比要求
    config.p_h = 1.0 // 参与率，高，未敲出情况下客户对收益的占比要求
    
    config.option_fee = 0.035 // 期权费费率，默认年化，CalcPrice 时此入参不参与计算
    config.option_fee_interest = 0.03 // 期权费利率
    config.back_end_load = false // 期权费支付方式，false 为前端，true 为后端
    config.is_kop_delay = true // 敲出后是立即还是延期支付资金，false 为立即，true 为延期，欧式的此参数无效
    config.knock_o_occur = false // 是否已经敲出，仅针对敲出后到期支付资金，False 为尚未敲出，True 为已经敲出 // 欧式敲出观察早于到期日的最好使用延后清算
    config.knock_o_point = 0.0 // 发生敲出时的价格点位记录，主要用于敲出增强 // 目前鲨鱼鳍结构没有增强特性，但双鲨会用于判断敲出方向
    config.is_futures = false // 是否期货期权
    config.is_foreign = false // 是否外汇期权
    config.margin_rate = 0.0 // 保证金比例，1 为收取全额保证金，0 为不收保证金
    config.margin_interest = 0.0 // 保证金利率
    config.discount_payoff = false // 是否对票息等收支进行贴现，false 为不贴现，true 为做贴现
    config.discount_margin = false // 是否对保证金收支进行贴现，false 为不贴现，true 为做贴现
    config.discount_option_fee = false // 是否对期权费收支进行贴现，影响期权费后付及先付时交易占用资金，false 为不贴现，true 为做贴现
    config.compound_option_fee = false // 是否对期权费收支进行复利，影响期权费先付及后付时垫付占用资金，false 为不复利，true 为做复利
    config.extend_end_days = 0 // 产品结束时延后清算天数(交易日)，期间票息和保证金等照算
    config.market_close = false // 是否已经收盘，会影响交易和估值，false 为未收盘，true 为已收盘
    
    config.consumed_option_fee_rate = 0.0 // 对冲交易 消耗 的期权费占比，针对 option_fee 的小数非百分比格式
    config.occupied_option_fee_rate = 0.0 // 对冲交易 占用 的期权费占比，针对 option_fee 的小数非百分比格式
    
    config.prefix_rebate_ann_rate = 0.0 // 前端返息比率，非百分比（年化）
    config.prefix_rebate_ann_need = false // 是否支付前端返息（年化）
    config.prefix_rebate_abs_rate = 0.0 // 前端返息比率，非百分比（绝对）
    config.prefix_rebate_abs_need = false // 是否支付前端返息（绝对）
    config.suffix_rebate_ann_rate = 0.0 // 后端返息比率，非百分比（年化）
    config.suffix_rebate_ann_need = false // 是否支付后端返息（年化）
    config.suffix_rebate_abs_rate = 0.0 // 后端返息比率，非百分比（绝对）
    config.suffix_rebate_abs_need = false // 是否支付后端返息（绝对）
    config.discount_rebate = false // 是否对返息进行贴现，影响后端返息，false 为不贴现，true 为做贴现
    config.compound_rebate = false // 是否对返息进行复利，影响前端返息，false 为不复利，true 为做复利
    
    config.payoff_calc_method = 0 // 资金流计算方式
    
    let calc_price_u = 110.0 // 价格点上界
    let calc_price_d = 90.0 // 价格点下界
    let calc_price_g = 1.0 // 价格点间隔
    //config.calc_price = [90.0, 92.0, 94.0, 96.0, 98.0, 100.0, 102.0, 104.0, 106.0, 108.0, 110.0] // 计算价格序列
    config.calc_price = nj.arange(calc_price_d, calc_price_u + calc_price_g, calc_price_g).tolist() // 含价格点上下界
    
    // 用户不传入则默认与 runs_step、year_days 一致
    //config.runs_step_n = 360 // 产品自然日数(含延后清算) (可选)
    //config.year_days_n = 365 // 年自然日数量 (可选)
    //config.trading_days_n = nj.array([1, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 18, 19, 20, ..., 341, 342, 343, 344, 347, 348, 349, 350, 357, 360]).tolist() // 交易日期序列(自然日) (可选)
    
    config.run_from = 0 // 起始天数，第一天为零
    config.run_days = 1 // 运行天数
    
    let ret_cols = config.runs_step
    let ret_rows = config.calc_price.length
    
    //console.log(config.ToJson())
    
    let result = null
    
    let tasker_test = new tasker.Tasker()
    tasker_test.plugin_id = 'derivx_barrier_sharkfin'
    tasker_test.timeout_wait = 3600 // 秒
    tasker_test.distribute_type = 0 // 本地计算任务
    tasker_test.common_args = config.ToJson()
    
    tasker_test.method_id = func_calc_price
    
    //result = kernel.AssignTask(tasker_test) // 同步
    //console.log('同步:', result)
    //if(result['return_code'] !== 0) {
    //    console.log(result['return_code'], result['return_info'])
    //}
    //else {
    //    result = JSON.parse(result['result_data'])
    //    console.log('price:', result)
    //}
    
    //event_task_finish = new AbortController()
    //result = kernel.AssignTask(tasker_test, OnResult_Price) // 异步
    //console.log('异步:', result)
    //if(result['return_code'] !== 0) {
    //    console.log(result['return_code'], result['return_info'])
    //}
    //else {
    //    let tasker_id = result['tasker_id']
    //    const ret_wait = await promises.setTimeout(tasker_test.timeout_wait * 1000, '', { signal:event_task_finish.signal }).then(() => false, err => true) // 等待任务结果
    //    if(ret_wait != true) {
    //        console.log('等待任务结果超时！' + tasker_id)
    //    }
    //}
    
    tasker_test.method_id = func_calc_payoff
    
    //result = kernel.AssignTask(tasker_test) // 同步
    //if(result['return_code'] !== 0) {
    //    console.log(result['return_code'], result['return_info'])
    //}
    //else {
    //    result = JSON.parse(result['result_data'])
    //    console.log('payoff:', result)
    //}
    
    //event_task_finish = new AbortController()
    //result = kernel.AssignTask(tasker_test, OnResult_Payoff) // 异步
    //console.log('异步:', result)
    //if(result['return_code'] !== 0) {
    //    console.log(result['return_code'], result['return_info'])
    //}
    //else {
    //    let tasker_id = result['tasker_id']
    //    const ret_wait = await promises.setTimeout(tasker_test.timeout_wait * 1000, '', { signal:event_task_finish.signal }).then(() => false, err => true) // 等待任务结果
    //    if(ret_wait != true) {
    //        console.log('等待任务结果超时！' + tasker_id)
    //    }
    //}
    
    tasker_test.method_id = func_calc_greeks
    
    //let greek_flags = {"delta":"d"}
    let greek_flags = {"delta":"d", "gamma":"g", "vega":"v", "theta":"t", "rho":"r"}
    for(let [name, flag] of Object.entries(greek_flags)) {
        config.calc_greek = flag
        tasker_test.common_args = config.ToJson()
        
        //result = kernel.AssignTask(tasker_test) // 同步
        //if(result['return_code'] !== 0) {
        //    console.log(result['return_code'], result['return_info'])
        //}
        //else {
        //    result = JSON.parse(result['result_data'])
        //    console.log('greeks:', result)
        //}
        
        //event_task_finish = new AbortController()
        //result = kernel.AssignTask(tasker_test, OnResult_Greeks) // 异步
        //console.log('异步:', result)
        //if(result['return_code'] !== 0) {
        //    console.log(result['return_code'], result['return_info'])
        //}
        //else {
        //    let tasker_id = result['tasker_id']
        //    const ret_wait = await promises.setTimeout(tasker_test.timeout_wait * 1000, '', { signal:event_task_finish.signal }).then(() => false, err => true) // 等待任务结果
        //    if(ret_wait != true) {
        //        console.log('等待任务结果超时！' + tasker_id)
        //    }
        //}
    }
}

Test_DerivX_Barrier_Sharkfin()

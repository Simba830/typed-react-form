import React, { useState, useEffect, useRef } from 'react'

export type ObjectOrArray = {
    [TIndex in number | string]: any
}

/**
 * The keys of a type T, when T is an array then it returns number (to index the array), otherwise, a key of the object.
 */
export type KeyOf<T> = T extends any[] ? number : keyof T

type ErrorType<T, TError> = T extends ObjectOrArray
    ? ErrorMap<T, TError>
    : TError
type ErrorMap<T extends ObjectOrArray, TError> = {
    [TKey in KeyOf<T>]?: ErrorType<T[TKey], TError>
}

type AnyListener = (setValuesWasUsed: boolean) => void
type AnyListenersMap = {
    [key: string]: AnyListener
}

type Listener = (isDefault: boolean) => void
type ListenerIdMap = {
    [key: string]: Listener
}
type ListenersMap<T extends ObjectOrArray> = {
    [TKey in KeyOf<T>]?: ListenerIdMap
}

type DirtyMap<T extends ObjectOrArray> = {
    [TKey in KeyOf<T>]?: boolean
}

type State = {
    isSubmitting: boolean
}

// clones only the lower-most object
function memberCopy<T>(value: T): T {
    if (Array.isArray(value)) {
        return [...value] as any
    } else if (typeof value === 'object') {
        return { ...value }
    } else {
        throw new Error('Can only member-copy arrays and objects.')
    }
}

export class FormState<T extends ObjectOrArray, TError = string> {
    public formId!: number
    public values!: T
    public defaultValues!: T
    public dirty: DirtyMap<T> = {}
    public errors: ErrorMap<T, TError> = {}
    public state: State = { isSubmitting: false }
    public validate: (values: T) => ErrorMap<T, TError> = () => ({})

    // private stateListeners: StateListenersMap = {};
    private listeners: ListenersMap<T> = {}
    private anyListeners: AnyListenersMap = {}
    private static currentId = 0

    constructor(initialValues: T, defaultValues: T) {
        if (!defaultValues || !initialValues)
            throw new Error(
                'FormState.constructor: initialValues or defaultValues is null'
            )
        this.values = initialValues
        this.defaultValues = defaultValues
        this.formId = FormState.currentId++
    }

    public get isDirty(): boolean {
        // return true if some field was marked as dirty
        if (Object.keys(this.dirty).some((key) => this.dirty[key as KeyOf<T>]))
            return true

        // return true if a field was added or removed
        let valueKeys = Object.keys(this.values)
        if (valueKeys.length !== Object.keys(this.defaultValues).length)
            return true

        return false
    }

    public get anyError(): boolean {
        return Object.keys(this.errors).length > 0 //some((key) => this.errors[key as KeyType<T>])
    }

    public listen(key: KeyOf<T>, listener: Listener): string {
        let setters = this.listeners[key]
        if (!setters) {
            setters = {}
            this.listeners[key] = setters
        }
        let id = '' + FormState.currentId++
        setters[id] = listener
        return id
    }

    public listenAny(listener: AnyListener) {
        let id = '' + FormState.currentId++
        this.anyListeners[id] = listener
        return id
    }

    public setState(state: State) {
        this.state = state
        this.fireAllNormalListeners(false)
        this.fireAnyListeners(false)
    }

    public reset(values?: T) {
        this.setValues(values ?? this.defaultValues, {}, true)
    }

    public ignoreAny(id: string) {
        delete this.anyListeners[id]
    }

    public ignore(key: KeyOf<T>, id: string) {
        let setters = this.listeners[key]
        if (!setters) {
            console.warn('Ignore was called for no reason', key, id)
            return
        }
        delete setters[id]
    }

    /**
     * Sets a value on the form, will use the builtin validator. For manual validation, use setValueInternal.
     * @param key The field name to set.
     * @param value The new field value.
     */
    public setValue<U extends KeyOf<T>>(key: U, value: T[U]) {
        if (
            (value !== null && typeof value === 'object') ||
            Array.isArray(value)
        ) {
            console.warn(
                'Do not pass objects to setValue, use setValueInternal instead. When passing objects here, they will always be treated as dirty.'
            )
        }
        if (this.values[key] === value) return
        this.setValueInternal(key, value, this.defaultValues[key] !== value)
    }

    /**
     * Remove errors and dirty values for a field.
     * @param key The field name to remove errors and dirty for.
     */
    public unsetValue(key: KeyOf<T>) {
        delete this.dirty[key]
        delete this.errors[key]
        this.fireListener(key)
        this.fireAnyListeners(false)
    }

    /**
     * Set a value the advanced way.
     * @param key The field name to set.
     * @param value The new value of the field.
     * @param dirty Is this field dirty?
     * @param error The error this field emits, leave undefined to use the forms validator, set null to signal no error.
     * @param skipId The field listener to skip.
     */
    public setValueInternal<U extends KeyOf<T>, V extends T[U]>(
        key: U,
        value: V,
        dirty: boolean,
        error?: ErrorType<V, TError> | null,
        skipId?: string
    ) {
        this.values[key] = value
        this.dirty[key] = dirty
        if (error !== undefined) {
            if (error === null || Object.keys(error).length === 0)
                delete this.errors[key]
            else this.errors[key] = error
        } else {
            this.errors = this.validate(this.values)
        }

        this.fireListener(key, false, skipId)
        this.fireAnyListeners(false, skipId)
    }

    /**
     * Sets errors for a form.
     * @param errors The errors to set in this form, leave undefined to use the forms validator. Will also trigger child and parent forms.
     * @param skipId The field listener to skip.
     */
    public setErrors(errors?: ErrorMap<T, TError>, skipId?: string) {
        if (errors === undefined) errors = this.validate(this.values)
        if (
            Object.keys(this.errors).length === 0 &&
            Object.keys(errors).length === 0
        )
            return
        this.errors = errors

        this.fireAllNormalListeners(false, skipId)
        this.fireAnyListeners(true, skipId)
    }

    public setError<U extends KeyOf<T>>(
        name: U,
        error: ErrorType<T[U], TError>
    ) {
        if (this.errors[name] === error) return
        this.errors[name] = error
        this.fireAllNormalListeners(false)
        this.fireAnyListeners(true)
    }

    /**
     *
     * @param setValues The values to set in this form, will also notify parent and child forms.
     * @param errors The errors to set on this form, leave undefined to use the validator.
     * @param isDefault Are these values the default values of the form?
     * @param state The state of the form.
     * @param skipId The field listener to skip.
     */
    public setValues(
        setValues: T,
        errors?: ErrorMap<T, TError>,
        isDefault?: boolean,
        state?: State,
        skipId?: string
    ) {
        if (errors === null)
            throw new Error(
                'errors is null, use undefined to not set any errors'
            )
        if (!setValues) throw new Error('setValues is undefined')
        if (isDefault) {
            this.defaultValues = setValues
            this.values = memberCopy(setValues)
            this.dirty = {}
        } else {
            this.values = setValues
        }
        if (errors !== undefined) this.errors = errors
        else this.errors = this.validate(this.values)
        if (state !== undefined) this.state = state

        if (!this.values) {
            throw new Error('this.values is null after setValues')
        }

        this.fireAllNormalListeners(isDefault, skipId)
        this.recalculateDirty()
        this.fireAnyListeners(true, skipId)
    }

    private recalculateDirty() {
        // Recalculate dirty values
        let keys = Object.keys(this.values)
        for (let i = 0; i < keys.length; i++) {
            let name = keys[i] as KeyOf<T>
            let value = this.values[name]
            if (typeof value === 'object' || Array.isArray(value)) continue // do not
            this.dirty[name] = this.defaultValues[name] !== value
        }
    }

    private fireListener(key: KeyOf<T>, isDefault?: boolean, skipId?: string) {
        let listeners = this.listeners[key]
        if (listeners) {
            // Call all listeners for the set field
            Object.keys(listeners!).forEach((id) => {
                if (id !== skipId) listeners![id](isDefault ?? false)
            })
        }
    }

    private fireAllNormalListeners(isDefault?: boolean, skipId?: string) {
        // Call all listeners for each set field
        Object.keys(this.values).forEach((keyString) => {
            this.fireListener(keyString as KeyOf<T>, isDefault, skipId)
        })
    }

    private fireAnyListeners(setValuesWasUsed: boolean, skipId?: string) {
        // Call all listeners that listen for any change
        Object.keys(this.anyListeners).forEach((id) => {
            if (id !== skipId) this.anyListeners[id](setValuesWasUsed)
        })
    }
}

export function useAnyListener<T extends ObjectOrArray, TError>(
    form: FormState<T, TError>,
    onlyOnSetValues: boolean = false
) {
    const [, setRender] = useState(0)

    useEffect(() => {
        let id = form.listenAny((setValuesWasUsed) => {
            if (!onlyOnSetValues || setValuesWasUsed) setRender((r) => r + 1)
        })
        return () => form.ignoreAny(id)
    }, [form, onlyOnSetValues])

    return form
}

export type AnyListenerProps<T extends ObjectOrArray, TError> = {
    form: FormState<T, TError>
    onlyOnSetValues?: boolean
    render: (props: {
        values: T
        errors: ErrorMap<T, TError>
        dirty: DirtyMap<T>
        isDirty: boolean
        anyError: boolean
        state: State
        setValues: (values: T) => void
    }) => React.ReactNode
}

export function AnyListener<T extends ObjectOrArray, TError>(
    props: AnyListenerProps<T, TError>
) {
    const values = useAnyListener(props.form, props.onlyOnSetValues)
    return <>{props.render(values)}</>
}

export type UseFormValues<TValue, TError> = {
    value: TValue
    error?: ErrorType<TValue, TError>
    dirty?: boolean
    isSubmitting: boolean
    setValue: (value: TValue) => void
}

export function useFormValue<
    T extends ObjectOrArray,
    TKey extends KeyOf<T>,
    TValue extends T[TKey],
    TError
>(form: FormState<T, TError>, name: TKey): UseFormValues<TValue, TError> {
    const [value, setValue] = useState(() => ({
        value: form.values[name],
        error: form.errors[name],
        dirty: form.dirty[name],
        isSubmitting: form.state.isSubmitting,
        setValue: (value: TValue) => form.setValue(name, value)
    }))

    useEffect(() => {
        let id = form.listen(name, (_isDefault) =>
            setValue({
                value: form.values[name],
                error: form.errors[name],
                dirty: form.dirty[name],
                isSubmitting: form.state.isSubmitting,
                setValue: (value: TValue) => form.setValue(name, value)
            })
        )
        return () => form.ignore(name, id)
    }, [form, name])

    return value
}

export type ListenerProps<
    T extends ObjectOrArray,
    TKey extends KeyOf<T>,
    TValue extends T[TKey],
    TError
> = {
    form: FormState<T, TError>
    name: TKey
    render: (props: {
        value: TValue
        dirty?: boolean
        error?: ErrorType<TValue, TError>
        state: State
        setValue: (value: TValue) => void
    }) => React.ReactNode
}

export function Listener<
    T extends ObjectOrArray,
    TKey extends KeyOf<T>,
    TValue extends T[TKey],
    TError
>(props: ListenerProps<T, TKey, TValue, TError>) {
    const values = useListener(props.form, props.name)
    return <>{props.render(values)}</>
}

export function useListener<
    T extends ObjectOrArray,
    TKey extends KeyOf<T>,
    TError
>(form: FormState<T, TError>, name: TKey) {
    const [, setRender] = useState(0)

    useEffect(() => {
        let id = form.listen(name, () => setRender((r) => r + 1))
        return () => form.ignore(name, id)
    }, [form, name])

    return {
        dirty: form.dirty[name],
        error: form.errors[name],
        value: form.values[name],
        state: form.state,
        setValue: (value: T[TKey]) => form.setValue(name, value)
    }
}

export type FormProps<T extends ObjectOrArray> = {
    values: T
    render: (form: FormState<T>) => React.ReactNode
}

export function Form<T extends ObjectOrArray>(props: FormProps<T>) {
    const form = useForm(props.values)
    return props.render(form)
}

export type ChildFormProps<
    TParent extends ObjectOrArray,
    TKey extends KeyOf<TParent>,
    TValue extends TParent[TKey]
> = {
    parent: FormState<TParent>
    name: TKey
    render: (form: FormState<TValue>) => JSX.Element
}

export function ChildForm<
    TParent extends ObjectOrArray,
    TKey extends KeyOf<TParent>,
    TValue extends TParent[TKey]
>(props: ChildFormProps<TParent, TKey, TValue>) {
    const childForm = useChildForm(props.parent, props.name)
    return props.render(childForm)
}

export function useForm<T>(values: T) {
    let ref = useRef<FormState<T> | null>(null)

    if (!ref.current) {
        ref.current = new FormState<T>(memberCopy(values), values)
    }

    useEffect(() => {
        ref.current!.setValues(values, {}, true)
    }, [values])

    return ref.current!
}

export function useChildForm<
    TParent extends ObjectOrArray,
    TKey extends KeyOf<TParent>,
    TValue extends TParent[TKey],
    TParentError
>(parent: FormState<TParent, TParentError>, name: TKey) {
    let ref = useRef<FormState<TValue, TParentError> | null>(null)

    if (!ref.current) {
        ref.current = new FormState<TValue, TParentError>(
            memberCopy(parent.values[name]),
            parent.defaultValues[name] ?? parent.values[name]
        )
    }

    useEffect(() => {
        let parentId = parent.listen(name, (isDefault) => {
            ref.current!.setValues(
                parent.values[name],
                parent.errors[name] ?? {},
                isDefault,
                parent.state,
                id
            )
        })
        let id = ref.current!.listenAny(() => {
            parent.setValueInternal(
                name,
                ref.current!.values,
                ref.current!.isDirty,
                ref.current!.errors as ErrorType<TValue, TParentError>,
                parentId
            )
        })
        ref.current!.setValues(
            memberCopy(parent.values[name]),
            parent.errors[name]
        )

        let i = ref.current!
        return () => {
            i.ignoreAny(id)
            parent.ignore(name, parentId)
            parent.unsetValue(name)
        }
    }, [parent, name])

    return ref.current!
}

export function yupValidator<T>(
    schema: any,
    transform: (message: any) => any = (s) => s
) {
    return (values: T) => {
        try {
            schema.validateSync(values, { abortEarly: false })
            return {}
        } catch (ex) {
            return yupErrorsToErrorMap(ex.inner, transform)
        }
    }
}

export function yupErrorsToErrorMap(
    errors: any[],
    transform: (message: any) => any = (s) => s
) {
    let obj = {} as any
    for (let i = 0; i < errors.length; i++) {
        let err = errors[i]
        let pathSegments = [...err.path.matchAll(/(\w+)/gi)].map((e) => e[0])
        let o = obj
        for (let j = 0; j < pathSegments.length; j++) {
            let key = pathSegments[j]
            let oo = o[key]
            if (!oo) {
                oo = {}
                o[key] = oo
            }
            if (j === pathSegments.length - 1) {
                o[key] = transform(err.message)
            } else {
                o = oo
            }
        }
    }
    return obj
}

export type ErrorFieldProps<T extends ObjectOrArray> = {
    form: FormState<T>
    name: KeyOf<T>
    as: (props: { children: React.ReactNode }) => JSX.Element
}

export function ErrorField<T extends ObjectOrArray>(props: ErrorFieldProps<T>) {
    const { error } = useFormValue(props.form, props.name)
    if (!error) return null
    return props.as({ children: error })
}

export type ArrayFieldProps<
    TParent extends ObjectOrArray,
    TKey extends KeyOf<TParent>,
    T extends TParent[TKey],
    TParentError
> = {
    parent: FormState<TParent, TParentError>
    name: TKey
    render: (props: {
        form: FormState<T, TParentError>
        values: T
        setValues: (values: T) => void
        remove: (index: number) => void
        clear: () => void
        move: (index: number, newIndex: number) => void
        swap: (index: number, newIndex: number) => void
        append: (value: T[number]) => void
    }) => React.ReactNode
}

export function ArrayField<
    TParent extends ObjectOrArray,
    TKey extends KeyOf<TParent>,
    T extends TParent[TKey],
    TParentError
>(props: ArrayFieldProps<TParent, TKey, T, TParentError>) {
    const form = useChildForm<TParent, TKey, T, TParentError>(
        props.parent,
        props.name
    )

    function append(value: T[number]) {
        form.setValues([...form.values, value] as any)
    }

    function remove(index: number) {
        let newValues = [...form.values]
        newValues.splice(index, 1)
        let newErrors = { ...form.errors }
        delete (newErrors as any)[index]
        form.setValues(newValues as any, newErrors)
    }

    function clear() {
        form.setValues([] as any, {})
    }

    function move(index: number, newIndex: number) {
        throw new Error('Move not implemented.')
        if (index === newIndex) return
        let values = [...form.values]
        values.splice(newIndex, 0, values.splice(index, 1)[0])
        let errors = { ...form.errors } as any
        if (newIndex > index) {
            let e = errors[index]
            for (let i = index; i < newIndex; i++) {
                errors[i] = errors[i + 1]
            }
            errors[newIndex] = e
        } else {
            let e = errors[index]
            for (let i = newIndex; i > index; i--) {
                errors[i] = errors[i - 1]
            }
            errors[newIndex] = e
        }
        form.setValues(values as any, errors)
    }

    function swap(index: number, newIndex: number) {
        let values = [...form.values]
        ;[values[index], values[newIndex]] = [values[newIndex], values[index]]
        let errors = { ...form.errors } as any
        ;[errors[index], errors[newIndex]] = [errors[newIndex], errors[index]]
        form.setValues(values as any, errors)
    }

    return (
        <AnyListener
            onlyOnSetValues
            form={form}
            render={({ values, setValues }) =>
                props.render({
                    form,
                    values,
                    setValues,
                    remove,
                    move,
                    swap,
                    clear,
                    append
                })
            }
        />
    )
}

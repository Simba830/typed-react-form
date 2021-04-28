import React from "react";
import { FormInput, useForm } from "typed-react-form";

interface RegisterData {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    repeatPassword: string;
    birthDate: Date;
}

function RegisterForm() {
    const form = useForm<RegisterData>({ firstName: "", lastName: "", email: "", password: "", repeatPassword: "", birthDate: new Date() });

    function submit() {
        console.log("onSubmit", form.values);
    }

    return (
        <form className="form" onSubmit={form.handleSubmit(submit)}>
            <label>First name</label>
            <FormInput form={form} name="firstName" />
            <label>Last name</label>
            <FormInput form={form} name="lastName" />
            <label>Email</label>
            <FormInput form={form} name="email" type="email" />
            <label>Birthday</label>
            <FormInput form={form} name="birthDate" type="date" />
            <label>Password</label>
            <FormInput form={form} name="password" type="password" />
            <label>Repeat</label>
            <FormInput form={form} name="repeatPassword" type="password" />
            <button style={{ gridColumn: "span 2" }} type="submit">
                Register
            </button>
        </form>
    );
}

export function App() {
    return (
        <div className="container">
            <div className="container__inner">
                <h2>Register</h2>
                <RegisterForm />
            </div>
        </div>
    );
}

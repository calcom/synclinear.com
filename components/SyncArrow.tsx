import React from "react";

interface IProps {
    direction: "left" | "right";
}

const SyncArrow = ({ direction }: IProps) => {
    return (
        <div
            className={`flex w-full items-center ${
                direction === "right" ? "rotate-180" : ""
            }`}
        >
            <div className="w-4 h-4 border-l-4 border-b-4 rotate-45 border-gray-100" />
            <div className="grow h-1 bg-gray-100 -translate-x-4" />
        </div>
    );
};

export default SyncArrow;

